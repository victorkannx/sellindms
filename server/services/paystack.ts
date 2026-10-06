import crypto from 'node:crypto';
import { requireConfig } from '../lib/config.js';
import { getAdminClient, isActiveAccess } from '../lib/supabase.js';

export type ProductRecord={id:string;name:string;slug:string;price:number|string;currency:string;is_active:boolean;product_type?:string};
export type VerifiedTransaction={id:number|string;tx_ref:string;status:string;amount:number|string;currency:string};
export type RefundRecord={originalTransactionId:string;status:string};

const key=()=>requireConfig(process.env.PAYSTACK_SECRET_KEY,'PAYSTACK_SECRET_KEY');
const api=async<T>(path:string,init?:RequestInit):Promise<T>=>{
 const r=await fetch('https://api.paystack.co'+path,{...init,headers:{Authorization:'Bearer '+key(),'Content-Type':'application/json',...(init?.headers??{})}});
 const p=await r.json().catch(()=>null) as any;
 if(!r.ok||p?.status!==true||p?.data===undefined) throw new Error(p?.message||'Paystack request failed.');
 return p.data as T;
};
const subunit=(n:number|string)=>{const v=Number(n);if(!Number.isFinite(v)||v<=0)throw new Error('Invalid payment amount.');return Math.round(v*100);};
export const createPaymentReference=()=> 'sidm_'+crypto.randomUUID().replaceAll('-','');

type PaystackPlan={plan_code?:string;code?:string;name:string;amount:number;currency:string;interval:string};
export type BillingInterval='monthly'|'annually';
const planCache=new Map<string,string>();
const subscriptionPlanConfig=(product:ProductRecord, billingInterval:BillingInterval)=>{
  const currency=String(product.currency).toUpperCase();
  if(product.slug==='sell-in-dms-pro') {
    const amounts = currency==='NGN' ? {monthly:38500, annual:415800} : {monthly:29, annual:Number(product.price)};
    return billingInterval==='monthly'
      ? {name:'Sell In DMs Pro Monthly',amount:amounts.monthly,interval:'monthly',description:'Sell In DMs Pro monthly subscription'}
      : {name:'Sell In DMs Pro Annual',amount:amounts.annual,interval:'annually',description:'Sell In DMs Pro annual subscription'};
  }
  if(product.slug==='sell-in-dms-automation') {
    const amounts = currency==='NGN' ? {monthly:65000, annual:702000} : {monthly:49, annual:Number(product.price)};
    return billingInterval==='monthly'
      ? {name:'Sell In DMs Automation Monthly',amount:amounts.monthly,interval:'monthly',description:'Sell In DMs Automation monthly subscription'}
      : {name:'Sell In DMs Automation Annual',amount:amounts.annual,interval:'annually',description:'Sell In DMs Automation annual subscription'};
  }
  return null;
};
export const getSubscriptionPricing=(product:ProductRecord,billingInterval:BillingInterval)=>{
  if(product.product_type!=='subscription') return null;
  const config=subscriptionPlanConfig(product,billingInterval);
  if(!config || !Number.isFinite(config.amount) || config.amount<=0) throw new Error('Unsupported Sell In DMs subscription product: '+product.slug);
  return {amount:config.amount,currency:String(product.currency).toUpperCase(),interval:billingInterval};
};
export const ensurePaystackPlan=async(product:ProductRecord,billingInterval:BillingInterval)=>{
  if(product.product_type!=='subscription') return undefined;
  const config=subscriptionPlanConfig(product,billingInterval);
  if(!config) throw new Error('Unsupported Sell In DMs subscription product: '+product.slug);
  const amount=subunit(config.amount);
  const currency=String(product.currency).toUpperCase();
  const cacheKey=product.slug+':'+currency+':'+billingInterval+':'+amount;
  const cached=planCache.get(cacheKey);
  if(cached) return cached;
  const plans=await api<PaystackPlan[]>('/plan?perPage=100');
  const existing=plans.find(p=>p.name===config.name&&Number(p.amount)===amount&&String(p.currency).toUpperCase()===currency&&String(p.interval).toLowerCase()===config.interval);
  const existingPlanCode=existing?.plan_code||existing?.code;
  if(existingPlanCode){planCache.set(cacheKey,existingPlanCode);return existingPlanCode;}
  const created=await api<PaystackPlan>('/plan',{method:'POST',body:JSON.stringify({name:config.name,amount,currency,interval:config.interval,description:config.description,send_sms:false,send_invoices:true})});
  const createdPlanCode=created?.plan_code||created?.code;
  if(!createdPlanCode) throw new Error('Paystack created the subscription plan without returning a plan code.');
  planCache.set(cacheKey,createdPlanCode);
  return createdPlanCode;
};
export const initializeFlutterwavePayment=async(i:{reference:string;product:ProductRecord;userId:string;email:string;fullName:string;redirectUrl:string;billingInterval?:BillingInterval})=>{
 const billingInterval=i.product.product_type==='subscription'?(i.billingInterval??'monthly'):undefined;
 const subscriptionPricing=billingInterval?getSubscriptionPricing(i.product,billingInterval):null;
 const body:any={email:i.email,amount:String(subunit(subscriptionPricing?.amount??i.product.price)),currency:subscriptionPricing?.currency??i.product.currency,reference:i.reference,callback_url:i.redirectUrl,metadata:{user_id:i.userId,product_id:i.product.id,product_slug:i.product.slug,billing_interval:billingInterval??'one_time'}};
 if(billingInterval) body.plan=await ensurePaystackPlan(i.product,billingInterval);
 return {authorizationUrl:(await api<{authorization_url:string}>('/transaction/initialize',{method:'POST',body:JSON.stringify(body)})).authorization_url,billingInterval};
};
export const verifyFlutterwaveTransaction=async(ref:string):Promise<VerifiedTransaction>=>{
 const d=await api<{id:number|string;status:string;amount:number;currency:string;reference:string}>('/transaction/verify/'+encodeURIComponent(ref));
 return {id:d.id,tx_ref:d.reference,status:d.status,amount:Number(d.amount)/100,currency:d.currency};
};
export const isTerminalChargeFailure=(s:string)=>['failed','abandoned','reversed','cancelled'].includes(s.toLowerCase());
export const secureEqual=(l:string,r:string)=>{const a=Buffer.from(l),b=Buffer.from(r);return a.length===b.length&&crypto.timingSafeEqual(a,b);};
export const verifyPaystackWebhookSignature=(raw:Buffer,sig:string)=>secureEqual(crypto.createHmac('sha512',key()).update(raw).digest('hex'),sig);
export const isRefundWebhookPayload=(p:unknown)=>typeof p==='object'&&p!==null&&typeof (p as any).event==='string'&&(p as any).event.startsWith('refund.');
export const getRefundTransactionId=(p:unknown)=>{const d=(p as any)?.data??{};const t=typeof d.transaction==='object'?d.transaction:{};for(const v of [t.reference,t.id,d.reference,d.transaction_id])if(typeof v==='string'||typeof v==='number')return String(v);};
export const verifyFlutterwaveRefund=async(ref:string):Promise<RefundRecord>=>{const d=await api<{status:string;transaction?:{reference?:string;id?:number|string}}>('/refund/'+encodeURIComponent(ref));return{originalTransactionId:String(d.transaction?.reference??d.transaction?.id??ref),status:d.status};};
export const isCompletedRefundStatus=(s:string)=>['processed','completed'].includes(s.toLowerCase());
export const recordVerifiedTerminalFailure=async(t:VerifiedTransaction)=>{const a=getAdminClient();const{data:o,error:e}=await a.from('orders').select('id').eq('flutterwave_reference',t.tx_ref).maybeSingle();if(e)throw e;if(!o)throw new Error('No order matches this verified Paystack reference.');const{error}=await a.from('orders').update({status:'failed',flutterwave_transaction_id:String(t.id)}).eq('id',o.id).neq('status','successful');if(error)throw error;return{orderId:o.id,status:'failed'};};
export const revokeVerifiedRefund=async(ref:string,verified?:RefundRecord)=>{const refund=verified??await verifyFlutterwaveRefund(ref);if(!isCompletedRefundStatus(refund.status))throw new Error('The Paystack refund is not confirmed as processed.');const a=getAdminClient();const{data:o,error:oe}=await a.from('orders').select('id,user_id,product_id,status').eq('flutterwave_reference',ref).maybeSingle();if(oe)throw oe;if(!o)throw new Error('No order matches this verified Paystack refund.');if(o.status==='successful'){const{error}=await a.from('orders').update({status:'refunded',refunded_at:new Date().toISOString()}).eq('id',o.id).eq('status','successful');if(error)throw error;}const{data:x,error:xe}=await a.from('product_access').select('id,status').eq('source_order_id',o.id).maybeSingle();if(xe)throw xe;if(x&&x.status!=='revoked'){const{error}=await a.from('product_access').update({status:'revoked',revoked_at:new Date().toISOString()}).eq('id',x.id).neq('status','revoked');if(error)throw error;}return{orderId:o.id,userId:o.user_id,productId:o.product_id};};
export const fulfillVerifiedTransaction=async(t:VerifiedTransaction)=>{const a=getAdminClient();const{data:o,error:oe}=await a.from('orders').select('id,user_id,product_id,amount,currency,status').eq('flutterwave_reference',t.tx_ref).maybeSingle();if(oe)throw oe;if(!o)throw new Error('No pending order matches this Paystack reference.');if(!o.user_id)throw new Error('The pending order is not linked to an authenticated customer.');const ok=t.status.toLowerCase()==='success'&&Number(t.amount)===Number(o.amount)&&t.currency.toUpperCase()===String(o.currency).toUpperCase();if(!ok){await a.from('orders').update({status:'failed',flutterwave_transaction_id:String(t.id)}).eq('id',o.id).neq('status','successful');throw new Error('The verified Paystack transaction did not match the expected order.');}if(o.status!=='successful'){const{error}=await a.from('orders').update({status:'successful',flutterwave_transaction_id:String(t.id),paid_at:new Date().toISOString()}).eq('id',o.id).eq('status','pending');if(error)throw error;}const{data:x,error:xe}=await a.from('product_access').select('id,status,expires_at').eq('user_id',o.user_id).eq('product_id',o.product_id).maybeSingle();if(xe)throw xe;if(!isActiveAccess(x)){const{error}=await a.from('product_access').upsert({user_id:o.user_id,product_id:o.product_id,status:'active',granted_at:new Date().toISOString(),revoked_at:null,expires_at:null,source_order_id:o.id},{onConflict:'user_id,product_id'});if(error)throw error;}return{orderId:o.id,userId:o.user_id,productId:o.product_id};};
