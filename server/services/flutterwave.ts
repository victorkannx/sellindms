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

type RefundRecord = {
  originalTransactionId: string;
  status: string;
};

const completedRefundStatuses = new Set([
  'completed',
  'completed-bank-transfer',
  'completed-momo',
  'completed-mpgs',
  'completed-offline',
  'completed-preauth',
]);

export const isCompletedRefundStatus = (status: string) => completedRefundStatuses.has(status.toLowerCase());

const sameIdentifier = (left: string | number, right: string | number) =>
  String(left) === String(right)
  || (Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Number(left) === Number(right));

const recordValue = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' ? value as Record<string, unknown> : {}
);

const stringValue = (...values: unknown[]) => {
  const value = values.find((candidate) => typeof candidate === 'string' || typeof candidate === 'number');
  return value === undefined ? undefined : String(value);
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

export const isTerminalChargeFailure = (status: string) => ['failed', 'cancelled', 'canceled'].includes(status.toLowerCase());

export const isRefundWebhookPayload = (payload: unknown) => {
  const root = recordValue(payload);
  const data = recordValue(root.data);
  const event = stringValue(root.event, root.type)?.toLowerCase() || '';
  return event.includes('refund') || Boolean(stringValue(root.TransactionId, root.transaction_id, root.transactionId, data.TransactionId, data.transaction_id, data.transactionId));
};

export const getRefundTransactionId = (payload: unknown) => {
  const root = recordValue(payload);
  const data = recordValue(root.data);
  return stringValue(root.TransactionId, root.transaction_id, root.transactionId, data.TransactionId, data.transaction_id, data.transactionId);
};

export const verifyFlutterwaveRefund = async (originalTransactionId: string): Promise<RefundRecord> => {
  const secret = requireConfig(runtimeConfig.flutterwaveSecretKey, 'FLUTTERWAVE_SECRET_KEY');
  const response = await fetch(`https://api.flutterwave.com/v3/refunds/${encodeURIComponent(originalTransactionId)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const payload = (await response.json().catch(() => null)) as { status?: string; message?: string; data?: unknown } | null;
  const data = recordValue(payload?.data);
  const returnedTransactionId = stringValue(data.TransactionId, data.transaction_id, data.transactionId, data.tx_id, data.txId);
  const refundStatus = stringValue(data.status)?.toLowerCase();
  if (!response.ok || payload?.status !== 'success' || !returnedTransactionId || !refundStatus || !sameIdentifier(returnedTransactionId, originalTransactionId)) {
    throw new Error(payload?.message || 'Flutterwave refund verification failed.');
  }
  return { originalTransactionId: returnedTransactionId, status: refundStatus };
};

export const recordVerifiedTerminalFailure = async (transaction: VerifiedTransaction) => {
  const status = transaction.status.toLowerCase();
  if (!isTerminalChargeFailure(status)) throw new Error('The Flutterwave transaction is not a terminal failure.');

  const admin = getAdminClient();
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('id, user_id, product_id, amount, currency, status, flutterwave_transaction_id, flutterwave_reference')
    .eq('flutterwave_reference', transaction.tx_ref)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) throw new Error('No order matches this verified Flutterwave reference.');

  const matches = transaction.tx_ref === order.flutterwave_reference
    && transaction.currency.toUpperCase() === order.currency.toUpperCase()
    && Number.isFinite(Number(transaction.amount))
    && Number(transaction.amount) === Number(order.amount);
  if (!matches) throw new Error('The verified terminal Flutterwave transaction did not match the expected order.');
  if (order.status === 'successful' || order.status === 'refunded' || order.status === (status === 'cancelled' || status === 'canceled' ? 'cancelled' : 'failed')) {
    return { orderId: order.id, status: order.status };
  }

  const terminalStatus = status === 'cancelled' || status === 'canceled' ? 'cancelled' : 'failed';
  const { error: updateError } = await admin
    .from('orders')
    .update({ status: terminalStatus, flutterwave_transaction_id: String(transaction.id) })
    .eq('id', order.id)
    .eq('status', 'pending');
  if (updateError) throw updateError;
  return { orderId: order.id, status: terminalStatus };
};

export const revokeVerifiedRefund = async (originalTransactionId: string, verifiedRefund?: RefundRecord) => {
  const refund = verifiedRefund || await verifyFlutterwaveRefund(originalTransactionId);
  if (!isCompletedRefundStatus(refund.status)) throw new Error('The Flutterwave refund is not confirmed completed.');
  const transaction = await verifyFlutterwaveTransaction(originalTransactionId);
  if (!sameIdentifier(transaction.id, refund.originalTransactionId)) throw new Error('The verified refund does not match the original Flutterwave transaction.');

  const admin = getAdminClient();
  let { data: order, error: orderError } = await admin
    .from('orders')
    .select('id, user_id, product_id, status, flutterwave_transaction_id, flutterwave_reference')
    .eq('flutterwave_transaction_id', refund.originalTransactionId)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) {
    const result = await admin
      .from('orders')
      .select('id, user_id, product_id, status, flutterwave_transaction_id, flutterwave_reference')
      .eq('flutterwave_reference', transaction.tx_ref)
      .maybeSingle();
    order = result.data;
    orderError = result.error;
  }
  if (orderError) throw orderError;
  if (!order || !order.user_id || !order.product_id) throw new Error('No order matches this verified Flutterwave refund.');
  if (order.status !== 'successful' && order.status !== 'refunded') throw new Error('The verified refund does not match a successful order.');

  if (order.status !== 'refunded') {
    const { error: orderUpdateError } = await admin
      .from('orders')
      .update({ status: 'refunded', refunded_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('status', 'successful');
    if (orderUpdateError) throw orderUpdateError;
  }

  const { data: access, error: accessReadError } = await admin
    .from('product_access')
    .select('id, status')
    .eq('source_order_id', order.id)
    .maybeSingle();
  if (accessReadError) throw accessReadError;
  if (access && access.status !== 'revoked') {
    const { error: accessUpdateError } = await admin
      .from('product_access')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('id', access.id)
      .neq('status', 'revoked');
    if (accessUpdateError) throw accessUpdateError;
  }

  return { orderId: order.id, userId: order.user_id, productId: order.product_id, refundStatus: refund.status };
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
