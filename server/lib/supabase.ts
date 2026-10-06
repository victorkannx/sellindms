import { createClient } from '@supabase/supabase-js';

type User = { id: string; email?: string | null; user_metadata?: Record<string, unknown> };
import { requireConfig, runtimeConfig } from './config.js';

export const getAdminClient = () =>
  createClient(
    requireConfig(runtimeConfig.supabaseUrl, 'SUPABASE_URL'),
    requireConfig(runtimeConfig.supabaseServiceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

export const getAuthClient = () =>
  createClient(
    requireConfig(runtimeConfig.supabaseUrl, 'SUPABASE_URL'),
    requireConfig(runtimeConfig.supabaseAnonKey, 'SUPABASE_ANON_KEY'),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

export const authenticatedUser = async (authorization?: string): Promise<User> => {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined;
  if (!token) {
    throw new Error('AUTH_REQUIRED');
  }

  const { data, error } = await (getAuthClient().auth as any).getUser(token);
  if (error || !data.user) {
    throw new Error('AUTH_REQUIRED');
  }

  return data.user;
};

export const isActiveAccess = (access: { status: string; expires_at?: string | null } | null) => {
  if (!access || access.status !== 'active') return false;
  return !access.expires_at || new Date(access.expires_at).getTime() > Date.now();
};
