import { runtimeConfig } from '../lib/config.js';

export type AiReplyBusinessContext = {
  id: string;
  businessName: string;
  description: string | null;
  targetCustomer: string | null;
  differentiator: string | null;
  businessInformation: string | null;
  policies: string | null;
};

export type AiReplyOffer = {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string | null;
  includedItems: string | null;
  benefits: string | null;
  deliveryInformation: string | null;
  terms: string | null;
  policies: string | null;
};

export type AiReplyScript = {
  id: string;
  scriptCode: string;
  title: string;
  situation: string | null;
  theySaid: string | null;
  betterReply: string | null;
  whyItWorks: string | null;
  alternativeResponse: string | null;
  nextMove: string | null;
  useThisWhen: string | null;
  category: string | null;
  stage: string | null;
};

export type AiReplyPromptInput = {
  customerMessage: string;
  conversationContext: string | null;
  mode: 'quick' | 'full';
  businessContext: AiReplyBusinessContext | null;
  activeOffer: AiReplyOffer | null;
  scripts: AiReplyScript[];
};

export type AiReplyOutput = {
  reply: string;
  whyThisWorks: string;
  nextMove: string;
  recommendedScriptCode: string | null;
};

type ChatMessage = {
  role: 'system' | 'user';
  content: string;
};

type ChatCompletionResponse = {
  error?: unknown;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

export class AiReplyConfigurationError extends Error {
  constructor() {
    super('AI reply generation is not configured.');
    this.name = 'AiReplyConfigurationError';
  }
}

export class AiReplyProviderError extends Error {
  constructor() {
    super('The AI reply service could not complete that request.');
    this.name = 'AiReplyProviderError';
  }
}

export class AiReplyOutputError extends Error {
  constructor() {
    super('The AI reply service returned an invalid response.');
    this.name = 'AiReplyOutputError';
  }
}

const outputSchema = {
  type: 'json_schema',
  json_schema: {
    name: 'sell_in_dms_reply',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        reply: { type: 'string' },
        why_this_works: { type: 'string' },
        next_move: { type: 'string' },
        recommended_script_code: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['reply', 'why_this_works', 'next_move', 'recommended_script_code'],
      additionalProperties: false,
    },
  },
} as const;

const maxOutputLength = 6_000;

const text = (value: string | null | undefined, fallback = 'Not provided') => value?.trim() || fallback;

const serializeBusinessContext = (context: AiReplyBusinessContext | null) => {
  if (!context) return 'No saved business context is available. Do not invent business facts.';
  return [
    `Business name: ${context.businessName}`,
    `Description: ${text(context.description)}`,
    `Target customer: ${text(context.targetCustomer)}`,
    `Differentiator: ${text(context.differentiator)}`,
    `Business information: ${text(context.businessInformation)}`,
    `Policies: ${text(context.policies)}`,
  ].join('\n');
};

const serializeOffer = (offer: AiReplyOffer | null) => {
  if (!offer) return 'No active offer is available. Do not invent price, features, availability, delivery, or terms.';
  const price = offer.price === null || offer.price === undefined
    ? 'Not provided'
    : `${offer.currency?.trim() || 'Currency not provided'} ${offer.price}`;
  return [
    `Name: ${offer.name}`,
    `Description: ${text(offer.description)}`,
    `Price: ${price}`,
    `Included items: ${text(offer.includedItems)}`,
    `Benefits: ${text(offer.benefits)}`,
    `Delivery information: ${text(offer.deliveryInformation)}`,
    `Terms: ${text(offer.terms)}`,
    `Policies: ${text(offer.policies)}`,
  ].join('\n');
};

const serializeScripts = (scripts: AiReplyScript[]) => {
  if (!scripts.length) return 'No relevant Sell In DMs script was retrieved. Do not name or imply a script framework.';
  return scripts.map((script, index) => [
    `SCRIPT ${index + 1}`,
    `script_code: ${script.scriptCode}`,
    `title: ${script.title}`,
    `situation: ${text(script.situation)}`,
    `they_said: ${text(script.theySaid)}`,
    `better_reply: ${text(script.betterReply)}`,
    `why_it_works: ${text(script.whyItWorks)}`,
    `alternative_response: ${text(script.alternativeResponse)}`,
    `next_move: ${text(script.nextMove)}`,
    `use_this_when: ${text(script.useThisWhen)}`,
    `category: ${text(script.category)}`,
    `stage: ${text(script.stage)}`,
  ].join('\n')).join('\n\n');
};

export const buildAiReplyMessages = (input: AiReplyPromptInput): ChatMessage[] => [
  {
    role: 'system',
    content: `You are the Sell In DMs Sales Agent. Help businesses respond naturally, clearly and helpfully while moving conversations toward a purchase when appropriate.

Use only the supplied business, offer, conversation and Sell In DMs information. General knowledge is for language only, never for facts.

Never invent or override business facts. Never invent prices, features, guarantees, availability, policies, discounts, testimonials, results or delivery terms. Never attack competitors. Never automatically add a sales CTA. If required information is missing, say it is unavailable rather than guessing. The agent may recommend not selling yet.

Understand what the customer is actually asking and answer directly. Use a relevant Sell In DMs framework when appropriate, adapting it to the real conversation rather than copying it blindly. Sound human, not like a chatbot. Do not use generic sales phrases or pressure the customer. If the customer asks a factual question, answer it only with supplied facts. If there is an objection, understand the concern. If ready to buy, make the supplied next purchase step clear. If not ready, respect that.

Return only JSON that matches the requested schema. Set recommended_script_code only to an exact script_code from the supplied retrieved scripts. If no supplied script is an appropriate recommendation, return null.`,
  },
  {
    role: 'user',
    content: `REPLY MODE: ${input.mode === 'full' ? 'Full Context' : 'Quick Reply'}

CUSTOMER MESSAGE:
${input.customerMessage}

CONVERSATION CONTEXT:
${text(input.conversationContext)}

SAVED BUSINESS CONTEXT:
${serializeBusinessContext(input.businessContext)}

ACTIVE OFFER:
${serializeOffer(input.activeOffer)}

RETRIEVED SELL IN DMS SCRIPTS:
${serializeScripts(input.scripts)}`,
  },
];

const parseProviderOutput = (content: string, scripts: AiReplyScript[]): AiReplyOutput => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AiReplyOutputError();
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AiReplyOutputError();
  const response = parsed as Record<string, unknown>;
  const reply = typeof response.reply === 'string' ? response.reply.trim() : '';
  const whyThisWorks = typeof response.why_this_works === 'string' ? response.why_this_works.trim() : '';
  const nextMove = typeof response.next_move === 'string' ? response.next_move.trim() : '';
  const requestedCode = typeof response.recommended_script_code === 'string'
    ? response.recommended_script_code.trim()
    : null;

  if (!reply || !whyThisWorks || !nextMove) throw new AiReplyOutputError();
  if ([reply, whyThisWorks, nextMove].some((value) => value.length > maxOutputLength)) throw new AiReplyOutputError();

  const validCode = requestedCode && scripts.some((script) => script.scriptCode === requestedCode)
    ? requestedCode
    : null;

  return { reply, whyThisWorks, nextMove, recommendedScriptCode: validCode };
};

const chatCompletionUrl = (baseUrl: string) => {
  const normalized = baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  return `${normalized}/v1/chat/completions`;
};

const getProvider = () => {
  if (runtimeConfig.openaiApiKey) {
    return {
      endpoint: chatCompletionUrl(runtimeConfig.openaiApiBase || 'https://api.openai.com/v1'),
      apiKey: runtimeConfig.openaiApiKey,
      model: runtimeConfig.aiReplyModel || 'gpt-5-mini',
    };
  }

  if (runtimeConfig.builtInForgeApiUrl && runtimeConfig.builtInForgeApiKey) {
    return {
      endpoint: chatCompletionUrl(runtimeConfig.builtInForgeApiUrl),
      apiKey: runtimeConfig.builtInForgeApiKey,
      model: runtimeConfig.aiReplyModel || 'gpt-5-mini',
    };
  }

  throw new AiReplyConfigurationError();
};

export const generateAiReply = async (input: AiReplyPromptInput): Promise<AiReplyOutput> => {
  const provider = getProvider();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: buildAiReplyMessages(input),
        response_format: outputSchema,
        max_completion_tokens: 1_200,
        reasoning: { effort: 'low' },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error('[sell-in-dms][ai-reply] provider request failed', { status: response.status });
      throw new AiReplyProviderError();
    }

    const payload = await response.json() as ChatCompletionResponse;
    if (payload.error) {
      console.error('[sell-in-dms][ai-reply] provider returned an error payload');
      throw new AiReplyProviderError();
    }
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new AiReplyOutputError();
    return parseProviderOutput(content, input.scripts);
  } catch (error) {
    if (error instanceof AiReplyConfigurationError || error instanceof AiReplyProviderError || error instanceof AiReplyOutputError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[sell-in-dms][ai-reply] provider request timed out');
    } else {
      console.error('[sell-in-dms][ai-reply] provider request failed', error);
    }
    throw new AiReplyProviderError();
  } finally {
    clearTimeout(timeout);
  }
};

export const validateAiReplyOutput = (content: string, scripts: AiReplyScript[]) => parseProviderOutput(content, scripts);
