import path from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { publicSupabaseConfig, requireConfig, runtimeConfig, safeAppOrigin } from './lib/config.js';
import { authenticatedUser, getAdminClient, isActiveAccess } from './lib/supabase.js';
import {
  AiReplyConfigurationError,
  AiReplyOutputError,
  AiReplyProviderError,
  generateAiReply,
  type AiReplyBusinessContext,
  type AiReplyOffer,
  type AiReplyScript,
} from './services/ai-reply.js';
import { getResourceGuide } from './services/resources.js';
import {
  createPaymentReference,
  fulfillVerifiedTransaction,
  getRefundTransactionId,
  isCompletedRefundStatus,
  isRefundWebhookPayload,
  isTerminalChargeFailure,
  initializeFlutterwavePayment,
  recordVerifiedTerminalFailure,
  revokeVerifiedRefund,
  secureEqual,
  verifyPaystackWebhookSignature,
  verifyFlutterwaveTransaction,
  verifyFlutterwaveRefund,
  type ProductRecord,
  type BillingInterval,
  getSubscriptionPricing,
} from './services/flutterwave.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const app = express();
const port = Number(process.env.PORT || 3000);

const sendError = (res: Response, status: number, code: string, message: string, details?: Record<string, unknown>) =>
  res.status(status).json({ error: { code, message, ...details } });

const asyncRoute = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => void handler(req, res, next).catch(next);

const aiReplySessionFields = 'id, user_id, customer_message, conversation_context, business_context_id, offer_id, recommended_script_id, generated_reply, next_move, created_at';
const aiReplyScriptFields = 'id, script_code, title, situation, they_said, better_reply, why_it_works, alternative_response, next_move, use_this_when, categories(name), stages(name)';
const inFlightAiReplyUsers = new Set<string>();

class AiReplyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiReplyInputError';
  }
}

type AiReplyRequestInput = {
  customerMessage: string;
  conversationContext: string | null;
  mode: 'quick' | 'full';
};

const asOptionalText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

const readAiReplyInput = (body: unknown): AiReplyRequestInput => {
  const request = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const customerMessage = asOptionalText(request.customerMessage);
  const conversationContext = asOptionalText(request.conversationContext);
  const mode = request.mode === 'full' ? 'full' : 'quick';

  if (!customerMessage) throw new AiReplyInputError('Paste the customerâs latest message before continuing.');
  if (customerMessage.length > 20_000 || (conversationContext?.length || 0) > 20_000) {
    throw new AiReplyInputError('Keep each conversation field under 20,000 characters.');
  }

  return { customerMessage, conversationContext, mode };
};

const relationName = (value: unknown) => {
  const record = Array.isArray(value) ? value[0] : value;
  return record && typeof record === 'object' && 'name' in record && typeof record.name === 'string' ? record.name : null;
};

const toAiReplyScript = (row: Record<string, any>): AiReplyScript => ({
  id: String(row.id),
  scriptCode: String(row.script_code),
  title: String(row.title),
  situation: typeof row.situation === 'string' ? row.situation : null,
  theySaid: typeof row.they_said === 'string' ? row.they_said : null,
  betterReply: typeof row.better_reply === 'string' ? row.better_reply : null,
  whyItWorks: typeof row.why_it_works === 'string' ? row.why_it_works : null,
  alternativeResponse: typeof row.alternative_response === 'string' ? row.alternative_response : null,
  nextMove: typeof row.next_move === 'string' ? row.next_move : null,
  useThisWhen: typeof row.use_this_when === 'string' ? row.use_this_when : null,
  category: relationName(row.categories),
  stage: relationName(row.stages),
});

const retrieveAiReplyScripts = async (customerMessage: string, conversationContext: string | null): Promise<AiReplyScript[]> => {
  const admin = getAdminClient();
  const combinedQuery = [customerMessage, conversationContext].filter(Boolean).join('\n');
  const findIds = async (queryText: string) => {
    const { data: matches, error: searchError } = await admin.rpc('search_scripts', {
      query_text: queryText,
      result_limit: 5,
    });
    if (searchError) throw searchError;
    const result: string[] = [];
    for (const match of (matches ?? []) as unknown[]) {
      const record = match && typeof match === 'object' ? match as Record<string, unknown> : null;
      if (typeof record?.id === 'string') result.push(record.id);
    }
    return result;
  };

  const ids = await findIds(combinedQuery);
  if (ids.length < 3 && conversationContext?.trim()) {
    for (const id of await findIds(customerMessage)) {
      if (!ids.includes(id)) ids.push(id);
      if (ids.length === 5) break;
    }
  }
  if (!ids.length) return [];

  const { data, error } = await admin
    .from('scripts')
    .select(aiReplyScriptFields)
    .in('id', ids)
    .eq('status', 'published');
  if (error) throw error;

  const byId = new Map<string, AiReplyScript>((data ?? []).map((script: Record<string, any>) => [String(script.id), toAiReplyScript(script)]));
  return ids.map((id: string) => byId.get(id)).filter((script: AiReplyScript | undefined): script is AiReplyScript => Boolean(script));
};

const aiReplyBusinessContext = (row: Record<string, any> | null | undefined): AiReplyBusinessContext | null => row ? {
  id: String(row.id),
  businessName: String(row.business_name),
  description: typeof row.description === 'string' ? row.description : null,
  targetCustomer: typeof row.target_customer === 'string' ? row.target_customer : null,
  differentiator: typeof row.differentiator === 'string' ? row.differentiator : null,
  businessInformation: typeof row.business_information === 'string' ? row.business_information : null,
  policies: typeof row.policies === 'string' ? row.policies : null,
} : null;

const aiReplyOffer = (row: Record<string, any> | null | undefined): AiReplyOffer | null => row ? {
  id: String(row.id),
  name: String(row.name),
  description: typeof row.description === 'string' ? row.description : null,
  price: row.price === null || row.price === undefined ? null : Number(row.price),
  currency: typeof row.currency === 'string' ? row.currency : null,
  includedItems: typeof row.included_items === 'string' ? row.included_items : null,
  benefits: typeof row.benefits === 'string' ? row.benefits : null,
  deliveryInformation: typeof row.delivery_information === 'string' ? row.delivery_information : null,
  terms: typeof row.terms === 'string' ? row.terms : null,
  policies: typeof row.policies === 'string' ? row.policies : null,
} : null;

const aiReplySessionResponse = (row: Record<string, any>) => ({
  id: String(row.id),
  userId: String(row.user_id),
  customerMessage: String(row.customer_message),
  conversationContext: typeof row.conversation_context === 'string' ? row.conversation_context : null,
  businessContextId: typeof row.business_context_id === 'string' ? row.business_context_id : null,
  offerId: typeof row.offer_id === 'string' ? row.offer_id : null,
  recommendedScriptId: typeof row.recommended_script_id === 'string' ? row.recommended_script_id : null,
  generatedReply: typeof row.generated_reply === 'string' ? row.generated_reply : null,
  nextMove: typeof row.next_move === 'string' ? row.next_move : null,
  createdAt: String(row.created_at),
});

const isRecentMatchingAiReplySession = (
  row: Record<string, any>,
  input: AiReplyRequestInput,
  businessContextId: string | null,
  offerId: string | null,
) => {
  const createdAt = typeof row.created_at === 'string' ? new Date(row.created_at).getTime() : Number.NaN;
  const withinRetryWindow = Number.isFinite(createdAt) && Date.now() - createdAt < 5 * 60_000;
  return withinRetryWindow
    && row.conversation_context === input.conversationContext
    && row.business_context_id === businessContextId
    && row.offer_id === offerId;
};

const SELL_IN_DMS_PRODUCT_SLUGS = ['sell-in-dms-core', 'sell-in-dms-pro', 'sell-in-dms-automation'] as const;

const getProductBySlug = async (slug: string): Promise<ProductRecord> => {
  if (!SELL_IN_DMS_PRODUCT_SLUGS.includes(slug as typeof SELL_IN_DMS_PRODUCT_SLUGS[number])) {
    throw new Error('Unsupported Sell In DMs product.');
  }
  const { data, error } = await getAdminClient()
    .from('products')
    .select('id, name, slug, price, currency, is_active, product_type')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('The active Sell In DMs product could not be found.');
  return data as ProductRecord;
};


const localizeProductForCountry = (product: ProductRecord, country: string | undefined): ProductRecord => {
  if (String(country || '').toUpperCase() === 'NG' && product.slug === 'sell-in-dms-core') {
    return { ...product, price: 7500, currency: 'NGN' };
  }
  return product;
};

const getCoreProduct = async (): Promise<ProductRecord> => getProductBySlug('sell-in-dms-core');

const accessForUser = async (userId: string) => {
  const product = await getCoreProduct();
  const { data, error } = await getAdminClient()
    .from('product_access')
    .select('id, status, expires_at, granted_at')
    .eq('user_id', userId)
    .eq('product_id', product.id)
    .maybeSingle();
  if (error) throw error;
  return { product, access: data };
};

const accessForProduct = async (userId: string, slug: string) => {
  const product = await getProductBySlug(slug);
  const { data, error } = await getAdminClient()
    .from('product_access')
    .select('id, status, expires_at, granted_at')
    .eq('user_id', userId)
    .eq('product_id', product.id)
    .maybeSingle();
  if (error) throw error;
  return { product, access: data };
};

const sellInDmsAccessForUser = async (userId: string) => {
  const { data, error } = await getAdminClient()
    .from('product_access')
    .select('id, status, expires_at, granted_at, products!inner(slug, is_active)')
    .eq('user_id', userId)
    .in('products.slug', [...SELL_IN_DMS_PRODUCT_SLUGS])
    .eq('products.is_active', true);
  if (error) throw error;
  return (data ?? []).find((row: any) => isActiveAccess(row)) ?? null;
};

const activeCustomer = async (authorization: string | undefined, res: Response) => {
  const user = await authenticatedUser(authorization);
  if (!(await sellInDmsAccessForUser(user.id))) {
    sendError(res, 403, 'ACCESS_REQUIRED', 'An active Sell In DMs entitlement is required to access resources.');
    return null;
  }
  return user;
};

const toPaymentStatusPath = (verified: boolean, reference?: string) => {
  const origin = safeAppOrigin();
  const query = reference ? `?reference=${encodeURIComponent(reference)}` : '';
  return `${origin}${verified ? '/payment/success' : '/payment/failed'}${query}`;
};

app.get('/_app/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'sell-in-dms' });
});

app.get('/api/public/config', (req, res) => {
  const config = publicSupabaseConfig();
  if (!config) {
    return sendError(
      res,
      503,
      'SUPABASE_CLIENT_NOT_CONFIGURED',
      'Supabase client configuration is not available yet.',
      { required: ['SUPABASE_URL', 'SUPABASE_ANON_KEY'] },
    );
  }

  const forwardedHost = req.header('x-forwarded-host') || req.header('host');
  const forwardedProto = req.header('x-forwarded-proto') || 'https';
  const requestOrigin = forwardedHost ? forwardedProto + '://' + forwardedHost : null;

  return res.json({
    ...config,
    authCallbackUrl: config.authCallbackUrl || (requestOrigin ? requestOrigin + '/auth/callback' : null),
  });
});

app.get('/api/public/products', asyncRoute(async (req, res) => {
  const country = req.header('x-vercel-ip-country');
  try {
    const { data, error } = await getAdminClient()
      .from('products')
      .select('id, name, slug, price, currency, product_type')
      .in('slug', [...SELL_IN_DMS_PRODUCT_SLUGS])
      .eq('is_active', true);
    if (error) throw error;
    res.json({
      products: (data ?? []).map((product: any) => {
        const localized = localizeProductForCountry(product as ProductRecord, country);
        return {
          id: localized.id,
          name: localized.name,
          slug: localized.slug,
          price: Number(localized.price),
          currency: localized.currency,
          productType: localized.product_type,
        };
      }),
    });
  } catch (error) {
    return sendError(res, 503, 'PRODUCT_CATALOG_NOT_CONFIGURED', 'The product catalog is not connected on this deployment yet.', {
      detail: error instanceof Error ? error.message : 'Supabase product catalog unavailable.',
    });
  }
}));

app.get('/api/public/config/status', (_req, res) => {
  res.json({
    supabaseUrl: Boolean(runtimeConfig.supabaseUrl),
    supabaseAnonKey: Boolean(runtimeConfig.supabaseAnonKey),
    supabaseServiceRoleKey: Boolean(runtimeConfig.supabaseServiceRoleKey),
    paystackSecretKey: Boolean(process.env.PAYSTACK_SECRET_KEY),
    appOrigin: Boolean(runtimeConfig.appOrigin),
    openaiApiKey: Boolean(runtimeConfig.openaiApiKey),
  });
});

app.get('/api/public/product', asyncRoute(async (req, res) => {
  const slug = typeof req.query.slug === 'string' ? req.query.slug : 'sell-in-dms-core';
  const product = localizeProductForCountry(await getProductBySlug(slug), req.header('x-vercel-ip-country'));
  res.json({
    id: product.id,
    name: product.name,
    slug: product.slug,
    price: Number(product.price),
    currency: product.currency,
    productType: product.product_type ?? 'one_time',
  });
}));

app.post('/api/payments/paystack/webhook', express.raw({ type: 'application/json' }), asyncRoute(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const signature = req.header('x-paystack-signature');
  if (!signature || !verifyPaystackWebhookSignature(raw, signature)) return sendError(res, 401, 'INVALID_WEBHOOK_SIGNATURE', 'The Paystack webhook signature could not be verified.');
  const payload = JSON.parse(raw.toString('utf8'));
  if (payload.event === 'charge.success') {
    const reference = payload?.data?.reference;
    if (!reference) return sendError(res, 400, 'MISSING_REFERENCE', 'The Paystack webhook did not include a transaction reference.');
    await fulfillVerifiedTransaction(await verifyFlutterwaveTransaction(String(reference)));
  }
  return res.status(200).json({ received: true });
}));

app.use(express.json({ limit: '100kb' }));

app.get('/api/resources', asyncRoute(async (req, res) => {
  if (!await activeCustomer(req.header('authorization'), res)) return;
  const { data, error } = await getAdminClient()
    .from('resources')
    .select('id, slug, title, description, resource_type, external_url, storage_path')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return res.json((data ?? []).map((resource) => ({ ...resource, has_content: Boolean(getResourceGuide(resource.slug)) })));
}));

app.get('/api/resources/:slug/content', asyncRoute(async (req, res) => {
  if (!await activeCustomer(req.header('authorization'), res)) return;
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  const { data: resource, error } = await getAdminClient()
    .from('resources')
    .select('id, slug, title, description, resource_type, external_url, storage_path')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  const guide = getResourceGuide(slug);
  if (!resource || !guide) return sendError(res, 404, 'RESOURCE_NOT_FOUND', 'This active resource could not be found.');
  return res.json({
    resource: { ...resource, has_content: true },
    guide,
  });
}));

app.post('/api/ai-replies', asyncRoute(async (req, res) => {
  const user = await activeCustomer(req.header('authorization'), res);
  if (!user) return;
  const input = readAiReplyInput(req.body);

  if (inFlightAiReplyUsers.has(user.id)) {
    return sendError(res, 409, 'AI_REPLY_IN_PROGRESS', 'Your reply is already being prepared. Please wait for it to finish.');
  }

  inFlightAiReplyUsers.add(user.id);
  try {
    const admin = getAdminClient();
    const [contextResult, offerResult] = await Promise.all([
      admin
        .from('business_contexts')
        .select('id, business_name, description, target_customer, differentiator, business_information, policies')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1),
      admin
        .from('offers')
        .select('id, name, description, price, currency, included_items, benefits, delivery_information, terms, policies')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle(),
    ]);
    if (contextResult.error) throw contextResult.error;
    if (offerResult.error) throw offerResult.error;

    const businessContext = aiReplyBusinessContext(contextResult.data?.[0]);
    const activeOffer = aiReplyOffer(offerResult.data);
    const { data: recentSessions, error: recentSessionsError } = await admin
      .from('ai_reply_sessions')
      .select(aiReplySessionFields)
      .eq('user_id', user.id)
      .eq('customer_message', input.customerMessage)
      .order('created_at', { ascending: false })
      .limit(8);
    if (recentSessionsError) throw recentSessionsError;

    const matchingSession = (recentSessions ?? []).find((session: Record<string, any>) => isRecentMatchingAiReplySession(
      session,
      input,
      businessContext?.id || null,
      activeOffer?.id || null,
    ));
    if (matchingSession?.generated_reply && matchingSession.next_move) {
      return res.status(200).json({
        session: aiReplySessionResponse(matchingSession),
        whyThisWorks: null,
        recommendedScriptCode: null,
        reused: true,
      });
    }

    let createdSession = matchingSession;
    if (!createdSession) {
      const { data, error: createError } = await admin
      .from('ai_reply_sessions')
      .insert({
        user_id: user.id,
        customer_message: input.customerMessage,
        conversation_context: input.conversationContext,
        business_context_id: businessContext?.id || null,
        offer_id: activeOffer?.id || null,
      })
      .select(aiReplySessionFields)
      .single();
      if (createError || !data) throw createError || new Error('Your conversation could not be prepared.');
      createdSession = data;
    }

    const scripts = await retrieveAiReplyScripts(input.customerMessage, input.conversationContext);
    const generated = await generateAiReply({
      customerMessage: input.customerMessage,
      conversationContext: input.conversationContext,
      mode: input.mode,
      businessContext,
      activeOffer,
      scripts,
    });
    const recommendedScriptId = generated.recommendedScriptCode
      ? scripts.find((script) => script.scriptCode === generated.recommendedScriptCode)?.id || null
      : null;
    const { data: completedSession, error: completionError } = await admin
      .from('ai_reply_sessions')
      .update({
        generated_reply: generated.reply,
        next_move: generated.nextMove,
        recommended_script_id: recommendedScriptId,
      })
      .eq('id', createdSession.id)
      .eq('user_id', user.id)
      .select(aiReplySessionFields)
      .single();
    if (completionError || !completedSession) throw completionError || new Error('The generated reply could not be saved.');

    return res.status(201).json({
      session: aiReplySessionResponse(completedSession),
      whyThisWorks: generated.whyThisWorks,
      recommendedScriptCode: generated.recommendedScriptCode,
    });
  } finally {
    inFlightAiReplyUsers.delete(user.id);
  }
}));

const getOrCreatePaymentUser = async (email: string, fullName: string) => {
  const admin = getAdminClient();
  const normalizedEmail = email.trim().toLowerCase();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    email_confirm: false,
    user_metadata: { full_name: fullName },
  });
  if (created.user) return created.user;
  if (createError && !/already registered|already exists/i.test(createError.message)) throw createError;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((candidate) => String(candidate.email || '').toLowerCase() === normalizedEmail);
    if (found) return found;
    if (data.users.length < 1000) break;
  }
  throw new Error('The purchase account could not be prepared. Please try again.');
};

app.post('/api/checkout/flutterwave', asyncRoute(async (req, res) => {
  const authorization = req.header('authorization');
  const authenticated = authorization ? await authenticatedUser(authorization) : null;
  const submittedEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim().slice(0, 160) : '';
  if (!submittedEmail && !authenticated?.email) {
    return sendError(res, 400, 'EMAIL_REQUIRED', 'Enter the email you want to use for your purchase and access.');
  }
  if (!fullName) {
    return sendError(res, 400, 'NAME_REQUIRED', 'Enter your full name before continuing to payment.');
  }
  const user = authenticated || await getOrCreatePaymentUser(submittedEmail, fullName);
  const paymentEmail = user.email || submittedEmail;
  if (!paymentEmail) {
    return sendError(res, 400, 'EMAIL_REQUIRED', 'A valid email address is required before payment.');
  }
  const productSlug = typeof req.body?.productSlug === 'string' ? req.body.productSlug.trim() : 'sell-in-dms-core';
  const { product, access } = await accessForProduct(user.id, productSlug);
  if (isActiveAccess(access)) {
    return sendError(res, 409, 'ALREADY_ENTITLED', 'This account already has access to ' + product.name + '.');
  }

  const admin = getAdminClient();
  const { error: profileError } = await admin.from('profiles').upsert({
    id: user.id,
    email: user.email,
    full_name: fullName,
  });
  if (profileError) throw profileError;

  const paymentProduct = localizeProductForCountry(product, req.header('x-vercel-ip-country'));
  const requestedBillingInterval = req.body?.billingInterval === 'annually' ? 'annually' : 'monthly';
  const billingInterval: BillingInterval = paymentProduct.product_type === 'subscription' ? requestedBillingInterval : 'annually';
  const subscriptionPricing = getSubscriptionPricing(paymentProduct, billingInterval);
  const chargeAmount = subscriptionPricing?.amount ?? Number(paymentProduct.price);
  const chargeCurrency = subscriptionPricing?.currency ?? String(paymentProduct.currency).toUpperCase();
  const reference = createPaymentReference();
  const { data: order, error: orderError } = await admin
    .from('orders')
    .insert({
      user_id: user.id,
      product_id: paymentProduct.id,
      amount: chargeAmount,
      currency: chargeCurrency,
      status: 'pending',
      billing_interval: paymentProduct.product_type === 'subscription' ? billingInterval : null,
      flutterwave_reference: reference,
    })
    .select('id')
    .single();
  if (orderError || !order) throw orderError || new Error('The pending order could not be created.');

  try {
    const paymentUrl = await initializeFlutterwavePayment({
      reference,
      product: paymentProduct,
      userId: user.id,
      email: paymentEmail,
      fullName,
      redirectUrl: safeAppOrigin() + '/api/payments/flutterwave/callback',
    });
    return res.status(201).json({ paymentUrl: paymentUrl.authorizationUrl, reference, orderId: order.id, billingInterval: paymentUrl.billingInterval });
  } catch (error) {
    await admin.from('orders').update({ status: 'failed' }).eq('id', order.id).eq('status', 'pending');
    throw error;
  }
}));

app.get('/api/payments/flutterwave/callback', asyncRoute(async (req, res) => {
  const reference = [req.query.reference, req.query.trxref, req.query.tx_ref].find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  const transactionId = typeof req.query.transaction_id === 'string' ? req.query.transaction_id : undefined;
  const verificationReference = reference || transactionId;
  if (!verificationReference) return res.redirect(toPaymentStatusPath(false));

  try {
    const verifiedTransaction = await verifyFlutterwaveTransaction(verificationReference);
    await fulfillVerifiedTransaction(verifiedTransaction);
    return res.redirect(toPaymentStatusPath(true, verifiedTransaction.tx_ref));
  } catch {
    return res.redirect(toPaymentStatusPath(false, reference || transactionId));
  }
}));

app.get('/api/payments/status', asyncRoute(async (req, res) => {
  const user = await authenticatedUser(req.header('authorization'));
  const reference = typeof req.query.reference === 'string' ? req.query.reference : undefined;
  if (!reference) {
    return sendError(res, 400, 'REFERENCE_REQUIRED', 'A payment reference is required.');
  }

  const { data: order, error } = await getAdminClient()
    .from('orders')
    .select('id, status, paid_at, product_id, amount, currency')
    .eq('flutterwave_reference', reference)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!order) return sendError(res, 404, 'ORDER_NOT_FOUND', 'This payment could not be found for the signed-in account.');

  const { data: access, error: accessError } = await getAdminClient()
    .from('product_access')
    .select('id, status, expires_at, granted_at')
    .eq('user_id', user.id)
    .eq('product_id', order.product_id)
    .maybeSingle();
  if (accessError) throw accessError;
  return res.json({
    status: order.status,
    paidAt: order.paid_at,
    amount: Number(order.amount),
    currency: order.currency,
    accessActive: isActiveAccess(access),
  });
}));

app.get('/api/resources/:slug/download', asyncRoute(async (req, res) => {
  const user = await authenticatedUser(req.header('authorization'));
  const access = await sellInDmsAccessForUser(user.id);
  if (!access) {
    return sendError(res, 403, 'ACCESS_REQUIRED', 'An active Sell In DMs entitlement is required to download resources.');
  }

  const { data: resource, error } = await getAdminClient()
    .from('resources')
    .select('slug, external_url, storage_path, is_active')
    .eq('slug', req.params.slug)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!resource) return sendError(res, 404, 'RESOURCE_NOT_FOUND', 'This active resource could not be found.');

  if (resource.external_url) return res.json({ downloadUrl: resource.external_url });
  if (!resource.storage_path) return sendError(res, 404, 'DOWNLOAD_UNAVAILABLE', 'This resource does not have a downloadable file.');

  const bucket = requireConfig(runtimeConfig.resourceBucket, 'SUPABASE_RESOURCE_BUCKET');
  const { data, error: signError } = await getAdminClient().storage.from(bucket).createSignedUrl(resource.storage_path, 60);
  if (signError || !data?.signedUrl) throw signError || new Error('The resource download URL could not be created.');
  return res.json({ downloadUrl: data.signedUrl });
}));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  if (message === 'AUTH_REQUIRED') {
    return sendError(res, 401, 'AUTH_REQUIRED', 'Sign in to continue.');
  }
  if (error instanceof AiReplyInputError) {
    return sendError(res, 400, 'AI_REPLY_INPUT_INVALID', error.message);
  }
  if (error instanceof AiReplyConfigurationError) {
    return sendError(res, 503, 'AI_PROVIDER_NOT_CONFIGURED', 'AI replies are not configured yet. Please try again later.', {
      required: ['OPENAI_API_KEY or BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY'],
    });
  }
  if (error instanceof AiReplyProviderError || error instanceof AiReplyOutputError) {
    return sendError(res, 502, 'AI_GENERATION_FAILED', 'We could not generate a reply just now. Your conversation was saved, so please try again.');
  }
  if (message.startsWith('Configuration is missing:')) {
    const key = message.split(': ')[1];
    return sendError(res, 503, 'INTEGRATION_NOT_CONFIGURED', 'This secure integration is not configured yet.', { required: [key] });
  }
  console.error('[sell-in-dms]', error);
  return sendError(res, 500, 'REQUEST_FAILED', message);
});

const start = async () => {
  const httpServer = createHttpServer(app);
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: path.join(projectRoot, 'client'),
      server: { middlewareMode: true, allowedHosts: true, hmr: { server: httpServer } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(projectRoot, 'dist');
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/') && req.path !== '/_app/health') {
        return res.sendFile(path.join(dist, 'index.html'));
      }
      return next();
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Sell In DMs is listening on http://0.0.0.0:${port}`);
  });
};

export { app };

if (process.env.VERCEL !== '1') {
  void start();
}
