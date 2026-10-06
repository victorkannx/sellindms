const required = (name: string) => process.env[name]?.trim() || undefined;

export const runtimeConfig = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  openaiApiKey: required('OPENAI_API_KEY'),
  openaiApiBase: required('OPENAI_API_BASE'),
  builtInForgeApiUrl: required('BUILT_IN_FORGE_API_URL'),
  builtInForgeApiKey: required('BUILT_IN_FORGE_API_KEY'),
  aiReplyModel: required('AI_REPLY_MODEL'),
  flutterwavePublicKey: required('FLUTTERWAVE_PUBLIC_KEY'),
  flutterwaveSecretKey: required('FLUTTERWAVE_SECRET_KEY'),
  flutterwaveWebhookSecret: required('FLUTTERWAVE_WEBHOOK_SECRET'),
  appOrigin: required('APP_ORIGIN'),
  resourceBucket: required('SUPABASE_RESOURCE_BUCKET'),
} as const;

export const missing = (...names: Array<keyof typeof runtimeConfig>) =>
  names.filter((name) => !runtimeConfig[name]).map((name) => name.toUpperCase().replace(/[A-Z]/g, (letter, index) => (index ? `_${letter}` : letter)));

export const requireConfig = <T>(value: T | undefined, key: string): T => {
  if (!value) {
    throw new Error(`Configuration is missing: ${key}`);
  }
  return value;
};

export const publicSupabaseConfig = () => {
  if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseAnonKey) {
    return null;
  }

  return {
    supabaseUrl: runtimeConfig.supabaseUrl,
    supabaseAnonKey: runtimeConfig.supabaseAnonKey,
    authCallbackUrl: runtimeConfig.appOrigin ? safeAppOrigin() + '/auth/callback' : null,
  };
};

export const safeAppOrigin = () => {
  const origin = requireConfig(runtimeConfig.appOrigin, 'APP_ORIGIN');
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('APP_ORIGIN must use HTTPS outside localhost.');
  }
  return parsed.origin;
};
