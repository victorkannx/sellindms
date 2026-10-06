import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AiReplySession, BusinessContext, BusinessContextInput, Entitlement, Offer, OfferInput, Product, Resource, ResourceGuide, Script, Taxonomy } from '../types/domain';

const scriptFields = `
  id, script_code, slug, title, situation, they_said, bad_reply, better_reply,
  why_it_works, alternative_response, next_move, use_this_when, sort_order,
  categories(id, name, slug, description, sort_order),
  stages(id, name, slug, description, sort_order),
  script_niches(niches(id, name, slug))
`;

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';

const businessContextFields = 'id, user_id, business_name, description, target_customer, differentiator, business_information, policies, created_at, updated_at';
const offerFields = 'id, user_id, name, description, price, currency, included_items, benefits, delivery_information, terms, policies, is_active, created_at, updated_at';
const aiReplySessionFields = 'id, user_id, customer_message, conversation_context, business_context_id, offer_id, recommended_script_id, generated_reply, next_move, created_at';
const optionalText = (value: string) => value.trim() || null;

const normalizeBusinessContext = (row: Record<string, any>): BusinessContext => ({
  id: row.id,
  userId: row.user_id,
  businessName: row.business_name,
  description: row.description ?? null,
  targetCustomer: row.target_customer ?? null,
  differentiator: row.differentiator ?? null,
  businessInformation: row.business_information ?? null,
  policies: row.policies ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const normalizeOffer = (row: Record<string, any>): Offer => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  description: row.description ?? null,
  price: row.price === null || row.price === undefined ? null : Number(row.price),
  currency: row.currency,
  includedItems: row.included_items ?? null,
  benefits: row.benefits ?? null,
  deliveryInformation: row.delivery_information ?? null,
  terms: row.terms ?? null,
  policies: row.policies ?? null,
  isActive: Boolean(row.is_active),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const normalizeAiReplySession = (row: Record<string, any>): AiReplySession => ({
  id: row.id,
  userId: row.user_id,
  customerMessage: row.customer_message,
  conversationContext: row.conversation_context ?? null,
  businessContextId: row.business_context_id ?? null,
  offerId: row.offer_id ?? null,
  recommendedScriptId: row.recommended_script_id ?? null,
  generatedReply: row.generated_reply ?? null,
  nextMove: row.next_move ?? null,
  createdAt: row.created_at,
});

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

export const getPublicProducts = async (): Promise<Product[]> => {
  const response = await fetch('/api/public/products');
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'The product details are unavailable right now.');
  return payload.products as Product[];
};

export const getPublicProduct = async (slug = 'sell-in-dms-core'): Promise<Product> => {
  const response = await fetch('/api/public/product?slug=' + encodeURIComponent(slug));
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'The product details are unavailable right now.');
  return payload as Product;
};

export const getEntitlement = async (supabase: SupabaseClient): Promise<Entitlement> => {
  const { data: products, error: productError } = await supabase
    .from('products')
    .select('id, name, slug, price, currency, product_type')
    .in('slug', ['sell-in-dms-core', 'sell-in-dms-pro', 'sell-in-dms-automation'])
    .eq('is_active', true);
  if (productError) throw productError;

  const productList: Product[] = (products ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    slug: item.slug,
    price: item.price,
    currency: item.currency,
    productType: item.product_type === 'subscription' ? 'one_time' : item.product_type,
  }));
  if (!productList.length) return { active: false, product: null, expiresAt: null };

  const { data: accesses, error: accessError } = await supabase
    .from('product_access')
    .select('product_id, status, expires_at')
    .in('product_id', productList.map((item) => item.id));
  if (accessError) throw accessError;

  const priority = ['sell-in-dms-automation', 'sell-in-dms-pro', 'sell-in-dms-core'];
  for (const slug of priority) {
    const product = productList.find((item) => item.slug === slug);
    const access = product ? (accesses ?? []).find((item) => item.product_id === product.id) : null;
    const expired = !!access?.expires_at && new Date(access.expires_at).getTime() <= Date.now();
    if (product && access?.status === 'active' && !expired) {
      return {
        active: true,
        product,
        expiresAt: access?.expires_at ?? null,
      };
    }
  }

  return { active: false, product: null, expiresAt: null };
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

export const getScriptsByIds = async (supabase: SupabaseClient, ids: string[]) => {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('scripts').select(scriptFields).in('id', ids).eq('status', 'published');
  if (error) throw error;
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
  const { data: sessionData } = await (supabase.auth as any).getSession();
  if (!sessionData.session?.access_token) throw new Error('Sign in again to access resources.');
  const response = await fetch('/api/resources', { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'Resources could not load.');
  return (payload as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: typeof row.description === 'string' ? row.description : null,
    resourceType: String(row.resource_type),
    externalUrl: typeof row.external_url === 'string' ? row.external_url : null,
    storagePath: typeof row.storage_path === 'string' ? row.storage_path : null,
    hasContent: row.has_content === true,
  }));
};

export const getResourceGuide = async (supabase: SupabaseClient, slug: string): Promise<{ resource: Resource; guide: ResourceGuide }> => {
  const { data: sessionData } = await (supabase.auth as any).getSession();
  if (!sessionData.session?.access_token) throw new Error('Sign in again to access this resource.');
  const response = await fetch(`/api/resources/${encodeURIComponent(slug)}/content`, { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'This resource could not load.');
  const row = payload.resource as Record<string, unknown>;
  return {
    resource: {
      id: String(row.id),
      slug: String(row.slug),
      title: String(row.title),
      description: typeof row.description === 'string' ? row.description : null,
      resourceType: String(row.resource_type),
      externalUrl: typeof row.external_url === 'string' ? row.external_url : null,
      storagePath: typeof row.storage_path === 'string' ? row.storage_path : null,
      hasContent: row.has_content === true,
    },
    guide: payload.guide as ResourceGuide,
  };
};

export const getBusinessContext = async (supabase: SupabaseClient, user: User): Promise<BusinessContext | null> => {
  const { data, error } = await supabase
    .from('business_contexts')
    .select(businessContextFields)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0] ? normalizeBusinessContext(data[0]) : null;
};

export const saveBusinessContext = async (supabase: SupabaseClient, user: User, input: BusinessContextInput, knownId?: string): Promise<BusinessContext> => {
  const payload = {
    business_name: input.businessName.trim(),
    description: optionalText(input.description),
    target_customer: optionalText(input.targetCustomer),
    differentiator: optionalText(input.differentiator),
    business_information: optionalText(input.businessInformation),
    policies: optionalText(input.policies),
  };

  let contextId = knownId;
  if (!contextId) contextId = (await getBusinessContext(supabase, user))?.id;

  const response = contextId
    ? await supabase.from('business_contexts').update(payload).eq('id', contextId).eq('user_id', user.id).select(businessContextFields).single()
    : await supabase.from('business_contexts').insert({ ...payload, user_id: user.id }).select(businessContextFields).single();
  if (response.error || !response.data) throw response.error || new Error('Business information could not be saved.');
  return normalizeBusinessContext(response.data);
};

export const getOffers = async (supabase: SupabaseClient, user: User): Promise<Offer[]> => {
  const { data, error } = await supabase
    .from('offers')
    .select(offerFields)
    .eq('user_id', user.id)
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(normalizeOffer);
};

export const getActiveOffer = async (supabase: SupabaseClient, user: User): Promise<Offer | null> => {
  const { data, error } = await supabase
    .from('offers')
    .select(offerFields)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeOffer(data) : null;
};

export const saveOffer = async (supabase: SupabaseClient, user: User, input: OfferInput, knownId?: string, currentIsActive = false): Promise<Offer> => {
  const payload = {
    name: input.name.trim(),
    description: optionalText(input.description),
    price: input.price,
    currency: input.currency.trim().toUpperCase() || 'NGN',
    included_items: optionalText(input.includedItems),
    benefits: optionalText(input.benefits),
    delivery_information: optionalText(input.deliveryInformation),
    terms: optionalText(input.terms),
    policies: optionalText(input.policies),
    // A newly selected active offer is activated in a separate safe transition below.
    is_active: knownId && currentIsActive && input.isActive,
  };
  const response = knownId
    ? await supabase.from('offers').update(payload).eq('id', knownId).eq('user_id', user.id).select(offerFields).single()
    : await supabase.from('offers').insert({ ...payload, user_id: user.id, is_active: false }).select(offerFields).single();
  if (response.error || !response.data) throw response.error || new Error('Offer could not be saved.');
  return normalizeOffer(response.data);
};

export const setOfferActive = async (supabase: SupabaseClient, user: User, offerId: string, active: boolean): Promise<void> => {
  if (active) {
    const { error: deactivateError } = await supabase.from('offers').update({ is_active: false }).eq('user_id', user.id).eq('is_active', true);
    if (deactivateError) throw deactivateError;
  }
  const { error } = await supabase.from('offers').update({ is_active: active }).eq('id', offerId).eq('user_id', user.id);
  if (error) throw error;
};

export const deleteOffer = async (supabase: SupabaseClient, user: User, offerId: string): Promise<void> => {
  const { error } = await supabase.from('offers').delete().eq('id', offerId).eq('user_id', user.id);
  if (error) throw error;
};

export const getRecentAiReplySessions = async (supabase: SupabaseClient, user: User, limit = 6): Promise<AiReplySession[]> => {
  const { data, error } = await supabase
    .from('ai_reply_sessions')
    .select(aiReplySessionFields)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(normalizeAiReplySession);
};

export const generateAiReply = async (
  supabase: SupabaseClient,
  input: { customerMessage: string; conversationContext: string; mode: 'quick' | 'full' },
): Promise<{ session: AiReplySession; whyThisWorks: string; recommendedScriptCode: string | null }> => {
  const customerMessage = input.customerMessage.trim();
  if (!customerMessage) throw new Error('Paste the customerâs latest message before continuing.');

  const { data: sessionData } = await (supabase.auth as any).getSession();
  if (!sessionData.session?.access_token) throw new Error('Sign in again before generating a reply.');

  const response = await fetch('/api/ai-replies', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      customerMessage,
      conversationContext: optionalText(input.conversationContext),
      mode: input.mode,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'We could not generate a reply just now.');
  if (!payload?.session) throw new Error('The generated reply could not be loaded.');

  return {
    session: normalizeAiReplySession(payload.session),
    whyThisWorks: typeof payload.whyThisWorks === 'string' ? payload.whyThisWorks : '',
    recommendedScriptCode: typeof payload.recommendedScriptCode === 'string' ? payload.recommendedScriptCode : null,
  };
};
