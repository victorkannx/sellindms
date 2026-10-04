import path from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { publicSupabaseConfig, requireConfig, runtimeConfig, safeAppOrigin } from './lib/config.js';
import { authenticatedUser, getAdminClient, isActiveAccess } from './lib/supabase.js';
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
  verifyFlutterwaveTransaction,
  verifyFlutterwaveRefund,
  type ProductRecord,
} from './services/flutterwave.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const app = express();
const port = Number(process.env.PORT || 3000);

const sendError = (res: Response, status: number, code: string, message: string, details?: Record<string, unknown>) =>
  res.status(status).json({ error: { code, message, ...details } });

const asyncRoute = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => void handler(req, res, next).catch(next);

const getCoreProduct = async (): Promise<ProductRecord> => {
  const { data, error } = await getAdminClient()
    .from('products')
    .select('id, name, slug, price, currency, is_active')
    .eq('slug', 'sell-in-dms-core')
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('The active Sell In DMs Core product could not be found.');
  return data as ProductRecord;
};

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

const activeCustomer = async (authorization: string | undefined, res: Response) => {
  const user = await authenticatedUser(authorization);
  const { access } = await accessForUser(user.id);
  if (!isActiveAccess(access)) {
    sendError(res, 403, 'ACCESS_REQUIRED', 'An active Sell In DMs Core entitlement is required to access resources.');
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

app.get('/api/public/config', (_req, res) => {
  const config = publicSupabaseConfig();
  if (!config) {
    return sendError(
      res,
      503,
      'SUPABASE_CLIENT_NOT_CONFIGURED',
      'Supabase client configuration is not available yet.',
      { required: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'APP_ORIGIN'] },
    );
  }
  return res.json(config);
});

app.get('/api/public/product', asyncRoute(async (_req, res) => {
  const product = await getCoreProduct();
  res.json({
    id: product.id,
    name: product.name,
    slug: product.slug,
    price: Number(product.price),
    currency: product.currency,
    productType: 'one_time',
  });
}));

app.post('/api/payments/flutterwave/webhook', express.raw({ type: 'application/json' }), asyncRoute(async (req, res) => {
  const webhookSecret = requireConfig(runtimeConfig.flutterwaveWebhookSecret, 'FLUTTERWAVE_WEBHOOK_SECRET');
  const signature = req.header('verif-hash');
  if (!signature || !secureEqual(signature, webhookSecret)) {
    return sendError(res, 401, 'INVALID_WEBHOOK_SIGNATURE', 'The Flutterwave webhook signature could not be verified.');
  }

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const payload = JSON.parse(raw.toString('utf8')) as unknown;
  if (isRefundWebhookPayload(payload)) {
    const originalTransactionId = getRefundTransactionId(payload);
    if (!originalTransactionId) {
      return sendError(res, 400, 'MISSING_REFUND_TRANSACTION', 'The Flutterwave refund webhook did not include the original transaction ID.');
    }
    const verifiedRefund = await verifyFlutterwaveRefund(originalTransactionId);
    if (isCompletedRefundStatus(verifiedRefund.status)) {
      await revokeVerifiedRefund(originalTransactionId, verifiedRefund);
    }
    return res.status(200).json({ received: true });
  }

  const data = payload && typeof payload === 'object' && 'data' in payload && payload.data && typeof payload.data === 'object'
    ? payload.data as { id?: string | number; tx_ref?: string }
    : {};
  const transactionId = data.id;
  if (!transactionId) {
    return sendError(res, 400, 'MISSING_TRANSACTION', 'The Flutterwave webhook did not include a transaction ID.');
  }

  const verifiedTransaction = await verifyFlutterwaveTransaction(String(transactionId));
  if (isTerminalChargeFailure(verifiedTransaction.status)) {
    await recordVerifiedTerminalFailure(verifiedTransaction);
    return res.status(200).json({ received: true });
  }
  await fulfillVerifiedTransaction(verifiedTransaction);
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

app.post('/api/checkout/flutterwave', asyncRoute(async (req, res) => {
  const user = await authenticatedUser(req.header('authorization'));
  if (!user.email) {
    return sendError(res, 400, 'EMAIL_REQUIRED', 'An authenticated email address is required before payment.');
  }

  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim().slice(0, 160) : '';
  if (!fullName) {
    return sendError(res, 400, 'NAME_REQUIRED', 'Enter your full name before continuing to payment.');
  }

  const { product, access } = await accessForUser(user.id);
  if (isActiveAccess(access)) {
    return sendError(res, 409, 'ALREADY_ENTITLED', 'This account already has access to Sell In DMs Core.');
  }

  const admin = getAdminClient();
  const { error: profileError } = await admin.from('profiles').upsert({
    id: user.id,
    email: user.email,
    full_name: fullName,
  });
  if (profileError) throw profileError;

  const reference = createPaymentReference();
  const { data: order, error: orderError } = await admin
    .from('orders')
    .insert({
      user_id: user.id,
      product_id: product.id,
      amount: Number(product.price),
      currency: product.currency,
      status: 'pending',
      flutterwave_reference: reference,
    })
    .select('id')
    .single();
  if (orderError || !order) throw orderError || new Error('The pending order could not be created.');

  try {
    const paymentUrl = await initializeFlutterwavePayment({
      reference,
      product,
      userId: user.id,
      email: user.email,
      fullName,
      redirectUrl: `${safeAppOrigin()}/api/payments/flutterwave/callback`,
    });
    return res.status(201).json({ paymentUrl, reference, orderId: order.id });
  } catch (error) {
    await admin.from('orders').update({ status: 'failed' }).eq('id', order.id).eq('status', 'pending');
    throw error;
  }
}));

app.get('/api/payments/flutterwave/callback', asyncRoute(async (req, res) => {
  const transactionId = typeof req.query.transaction_id === 'string' ? req.query.transaction_id : undefined;
  const reference = typeof req.query.tx_ref === 'string' ? req.query.tx_ref : undefined;
  if (!transactionId) {
    return res.redirect(toPaymentStatusPath(false, reference));
  }

  try {
    const verifiedTransaction = await verifyFlutterwaveTransaction(transactionId);
    await fulfillVerifiedTransaction(verifiedTransaction);
    return res.redirect(toPaymentStatusPath(true, verifiedTransaction.tx_ref));
  } catch {
    return res.redirect(toPaymentStatusPath(false, reference));
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

  const { access } = await accessForUser(user.id);
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
  const { access } = await accessForUser(user.id);
  if (!isActiveAccess(access)) {
    return sendError(res, 403, 'ACCESS_REQUIRED', 'An active Sell In DMs Core entitlement is required to download resources.');
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

void start();
