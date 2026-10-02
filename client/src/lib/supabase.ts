import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type PublicSupabaseConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

let client: SupabaseClient | null = null;
let configuration: PublicSupabaseConfig | null = null;

export const fetchSupabaseConfig = async () => {
  if (configuration) return configuration;
  const response = await fetch('/api/public/config');
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Supabase is not configured yet.');
  }
  configuration = payload as PublicSupabaseConfig;
  return configuration;
};

export const getSupabase = async () => {
  if (client) return client;
  const config = await fetchSupabaseConfig();
  client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
};

export const clearSupabaseClient = () => {
  client = null;
  configuration = null;
};
