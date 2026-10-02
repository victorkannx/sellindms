import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Entitlement, Product, Resource, Script, Taxonomy } from '../types/domain';

const scriptFields = `
  id, script_code, slug, title, situation, they_said, bad_reply, better_reply,
  why_it_works, alternative_response, next_move, use_this_when, sort_order,
  categories(id, name, slug, description, sort_order),
  stages(id, name, slug, description, sort_order),
  script_niches(niches(id, name, slug))
`;

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';

const taxonomyFrom = (row: Record<string, unknown> | null | undefined): Taxonomy | null => {
  if (!row || typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.slug !== 'string') return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: typeof row.description === 'string' ? row.description : null,
    sortOrder: typeof row.sort_order === 'number' ? row.sort_order : undefined,
  };
};

export const normalizeScript = (row: Record<string, any>): Script => ({
  id: row.id,
  scriptCode: row.script_code,
  slug: row.slug,
  title: row.title,
  situation: row.situation,
  theySaid: row.they_said ?? null,
  badReply: row.bad_reply ?? null,
  betterReply: row.better_reply,
  whyItWorks: row.why_it_works ?? null,
  alternativeResponse: row.alternative_response ?? null,
  nextMove: row.next_move ?? null,
  useThisWhen: row.use_this_when ?? null,
  category: taxonomyFrom(row.categories),
  stage: taxonomyFrom(row.stages),
  niches: (row.script_niches ?? []).map((item: Record<string, any>) => taxonomyFrom(item.niches)).filter(Boolean),
  sortOrder: row.sort_order ?? null,
});

export const getPublicProduct = async (): Promise<Product> => {
  const response = await fetch('/api/public/product');
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'The product details are unavailable right now.');
  return payload as Product;
};

export const getEntitlement = async (supabase: SupabaseClient): Promise<Entitlement> => {
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, name, slug, price, currency, product_type')
    .eq('slug', 'sell-in-dms-core')
    .eq('is_active', true)
    .maybeSingle();
  if (productError) throw productError;
  if (!product) return { active: false, product: null, expiresAt: null };

  const { data: access, error: accessError } = await supabase
    .from('product_access')
    .select('status, expires_at')
    .eq('product_id', product.id)
    .maybeSingle();
  if (accessError) throw accessError;
  const expired = !!access?.expires_at && new Date(access.expires_at).getTime() <= Date.now();

  return {
    active: access?.status === 'active' && !expired,
    product: {
      id: product.id,
      name: product.name,
      slug: product.slug,
      price: Number(product.price),
      currency: product.currency,
      productType: 'one_time',
    },
    expiresAt: access?.expires_at ?? null,
  };
};

export const getTaxonomy = async (supabase: SupabaseClient) => {
  const [stages, categories, niches] = await Promise.all([
    supabase.from('stages').select('id, name, slug, description, sort_order').order('sort_order'),
    supabase.from('categories').select('id, name, slug, description, sort_order').eq('is_active', true).order('sort_order'),
    supabase.from('niches').select('id, name, slug').eq('is_active', true).order('name'),
  ]);
  if (stages.error || categories.error || niches.error) throw new Error(getErrorMessage(stages.error || categories.error || niches.error));
  return {
    stages: (stages.data ?? []).map((row) => taxonomyFrom(row as Record<string, unknown>)!).filter(Boolean),
    categories: (categories.data ?? []).map((row) => taxonomyFrom(row as Record<string, unknown>)!).filter(Boolean),
    niches: (niches.data ?? []).map((row) => taxonomyFrom(row as Record<string, unknown>)!).filter(Boolean),
  };
};

export const getScriptBySlug = async (supabase: SupabaseClient, slug: string) => {
  const { data, error } = await supabase.from('scripts').select(scriptFields).eq('slug', slug).eq('status', 'published').maybeSingle();
  if (error) throw error;
  return data ? normalizeScript(data) : null;
};

export const searchScripts = async (supabase: SupabaseClient, query: string, limit = 24) => {
  const trimmed = query.trim();
  if (!trimmed) return listScripts(supabase, { limit });
  const { data: matches, error: searchError } = await supabase.rpc('search_scripts', { query_text: trimmed, result_limit: Math.min(limit, 50) });
  if (searchError) throw searchError;
  const ids: string[] = ((matches ?? []) as Array<{ id: string }>).map((script) => script.id);
  if (!ids.length) return [];
  const { data, error } = await supabase.from('scripts').select(scriptFields).in('id', ids).eq('status', 'published');
  if (error) throw error;
  const keyed = new Map((data ?? []).map((item) => [item.id, normalizeScript(item)]));
  return ids.map((id) => keyed.get(id)).filter((item): item is Script => Boolean(item));
};

export const listScripts = async (supabase: SupabaseClient, input: { limit?: number; categoryId?: string; stageId?: string; nicheId?: string; offset?: number } = {}) => {
  const limit = input.limit ?? 24;
  let query = supabase.from('scripts').select(scriptFields).eq('status', 'published').order('sort_order', { ascending: true }).range(input.offset ?? 0, (input.offset ?? 0) + limit - 1);
  if (input.categoryId) query = query.eq('category_id', input.categoryId);
  if (input.stageId) query = query.eq('stage_id', input.stageId);
  if (input.nicheId) {
    const { data: pairs, error: pairError } = await supabase.from('script_niches').select('script_id').eq('niche_id', input.nicheId);
    if (pairError) throw pairError;
    const ids = (pairs ?? []).map((pair) => pair.script_id);
    if (!ids.length) return [];
    query = query.in('id', ids);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(normalizeScript);
};

export const getRelatedScripts = async (supabase: SupabaseClient, scriptId: string) => {
  const { data: relations, error } = await supabase
    .from('related_scripts')
    .select('related_script_id, sort_order')
    .eq('script_id', scriptId)
    .order('sort_order');
  if (error) throw error;
  const ids = (relations ?? []).map((relation) => relation.related_script_id);
  if (!ids.length) return [];
  const { data, error: scriptsError } = await supabase.from('scripts').select(scriptFields).in('id', ids).eq('status', 'published');
  if (scriptsError) throw scriptsError;
  const keyed = new Map((data ?? []).map((item) => [item.id, normalizeScript(item)]));
  return ids.map((id) => keyed.get(id)).filter((item): item is Script => Boolean(item));
};

export const getSavedScripts = async (supabase: SupabaseClient) => {
  const { data, error } = await supabase
    .from('favorites')
    .select(`created_at, scripts(${scriptFields})`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((item: Record<string, any>) => item.scripts ? normalizeScript(item.scripts) : null).filter((item): item is Script => Boolean(item));
};

export const getRecentlyViewed = async (supabase: SupabaseClient) => {
  const { data, error } = await supabase
    .from('recently_viewed')
    .select(`last_viewed_at, view_count, scripts(${scriptFields})`)
    .order('last_viewed_at', { ascending: false })
    .limit(12);
  if (error) throw error;
  return (data ?? []).map((item: Record<string, any>) => item.scripts ? { script: normalizeScript(item.scripts), lastViewedAt: item.last_viewed_at, viewCount: item.view_count } : null).filter(Boolean) as Array<{ script: Script; lastViewedAt: string; viewCount: number }>;
};

export const getFavoriteIds = async (supabase: SupabaseClient) => {
  const { data, error } = await supabase.from('favorites').select('script_id');
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.script_id));
};

export const toggleFavorite = async (supabase: SupabaseClient, user: User, scriptId: string, currentlySaved: boolean) => {
  if (currentlySaved) {
    const { error } = await supabase.from('favorites').delete().eq('user_id', user.id).eq('script_id', scriptId);
    if (error) throw error;
    return false;
  }
  const { error } = await supabase.from('favorites').insert({ user_id: user.id, script_id: scriptId });
  if (error) throw error;
  await supabase.from('activity_events').insert({ user_id: user.id, event_name: 'SCRIPT_FAVORITED', script_id: scriptId, metadata: {} });
  return true;
};

export const trackScriptView = async (supabase: SupabaseClient, user: User, scriptId: string) => {
  const { data: existing, error: existingError } = await supabase
    .from('recently_viewed')
    .select('view_count')
    .eq('user_id', user.id)
    .eq('script_id', scriptId)
    .maybeSingle();
  if (existingError) throw existingError;
  const now = new Date().toISOString();
  const mutation = existing
    ? supabase.from('recently_viewed').update({ view_count: existing.view_count + 1, last_viewed_at: now }).eq('user_id', user.id).eq('script_id', scriptId)
    : supabase.from('recently_viewed').insert({ user_id: user.id, script_id: scriptId, view_count: 1, last_viewed_at: now });
  const { error } = await mutation;
  if (error) throw error;
  await supabase.from('activity_events').insert({ user_id: user.id, event_name: 'SCRIPT_VIEWED', script_id: scriptId, metadata: {} });
};

export const recordCopied = async (supabase: SupabaseClient, user: User, scriptId: string) => {
  const { error } = await supabase.from('activity_events').insert({ user_id: user.id, event_name: 'SCRIPT_COPIED', script_id: scriptId, metadata: {} });
  if (error) throw error;
};

export const getResources = async (supabase: SupabaseClient): Promise<Resource[]> => {
  const { data, error } = await supabase
    .from('resources')
    .select('id, slug, title, description, resource_type, external_url, storage_path')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    resourceType: row.resource_type,
    externalUrl: row.external_url,
    storagePath: row.storage_path,
  }));
};
