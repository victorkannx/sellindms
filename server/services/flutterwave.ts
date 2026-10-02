import crypto from 'node:crypto';
import { requireConfig, runtimeConfig } from '../lib/config.js';
import { getAdminClient, isActiveAccess } from '../lib/supabase.js';

export type ProductRecord = {
  id: string;
  name: string;
  slug: string;
  price: number | string;
  currency: string;
  is_active: boolean;
};

type VerifiedTransaction = {
  id: number | string;
  tx_ref: string;
  status: string;
  amount: number | string;
  currency: string;
};

export const createPaymentReference = () => `sidm_${crypto.randomUUID().replaceAll('-', '')}`;

export const secureEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const initializeFlutterwavePayment = async (input: {
  reference: string;
  product: ProductRecord;
  userId: string;
  email: string;
  fullName: string;
  redirectUrl: string;
}) => {
  const secret = requireConfig(runtimeConfig.flutterwaveSecretKey, 'FLUTTERWAVE_SECRET_KEY');
  const response = await fetch('https://api.flutterwave.com/v3/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tx_ref: input.reference,
      amount: String(input.product.price),
      currency: input.product.currency,
      redirect_url: input.redirectUrl,
      customer: { email: input.email, name: input.fullName },
      customizations: {
        title: 'Sell In DMs Core',
        description: 'One-time access to the Sell In DMs script library.',
      },
      meta: {
        user_id: input.userId,
        product_id: input.product.id,
        product_slug: input.product.slug,
      },
    }),
  });

  const payload = (await response.json().catch(() => null)) as { status?: string; message?: string; data?: { link?: string } } | null;
  if (!response.ok || payload?.status !== 'success' || !payload.data?.link) {
    throw new Error(payload?.message || 'Flutterwave payment initialization failed.');
  }

  return payload.data.link;
};

export const verifyFlutterwaveTransaction = async (transactionId: string) => {
  const secret = requireConfig(runtimeConfig.flutterwaveSecretKey, 'FLUTTERWAVE_SECRET_KEY');
  const response = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const payload = (await response.json().catch(() => null)) as { status?: string; message?: string; data?: VerifiedTransaction } | null;
  if (!response.ok || payload?.status !== 'success' || !payload.data) {
    throw new Error(payload?.message || 'Flutterwave transaction verification failed.');
  }
  return payload.data;
};

export const fulfillVerifiedTransaction = async (transaction: VerifiedTransaction) => {
  const admin = getAdminClient();
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('id, user_id, product_id, amount, currency, status, flutterwave_reference')
    .eq('flutterwave_reference', transaction.tx_ref)
    .maybeSingle();

  if (orderError) throw orderError;
  if (!order) throw new Error('No pending order matches this Flutterwave reference.');
  if (!order.user_id) throw new Error('The pending order is not linked to an authenticated customer.');

  const expectedAmount = Number(order.amount);
  const receivedAmount = Number(transaction.amount);
  const matches = transaction.status.toLowerCase() === 'successful'
    && transaction.tx_ref === order.flutterwave_reference
    && transaction.currency.toUpperCase() === order.currency.toUpperCase()
    && Number.isFinite(receivedAmount)
    && receivedAmount === expectedAmount;

  if (!matches) {
    await admin
      .from('orders')
      .update({ status: 'failed', flutterwave_transaction_id: String(transaction.id) })
      .eq('id', order.id)
      .neq('status', 'successful');
    throw new Error('The verified Flutterwave transaction did not match the expected order.');
  }

  if (order.status !== 'successful') {
    const { error: updateError } = await admin
      .from('orders')
      .update({
        status: 'successful',
        flutterwave_transaction_id: String(transaction.id),
        paid_at: new Date().toISOString(),
      })
      .eq('id', order.id);
    if (updateError) throw updateError;
  }

  const { data: existingAccess, error: accessReadError } = await admin
    .from('product_access')
    .select('id, status, expires_at')
    .eq('user_id', order.user_id)
    .eq('product_id', order.product_id)
    .maybeSingle();
  if (accessReadError) throw accessReadError;

  if (!isActiveAccess(existingAccess)) {
    const { error: accessError } = await admin
      .from('product_access')
      .upsert(
        {
          user_id: order.user_id,
          product_id: order.product_id,
          status: 'active',
          granted_at: new Date().toISOString(),
          revoked_at: null,
          expires_at: null,
          source_order_id: order.id,
        },
        { onConflict: 'user_id,product_id' },
      );
    if (accessError) throw accessError;
  }

  return { orderId: order.id, userId: order.user_id, productId: order.product_id };
};
