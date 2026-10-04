export type Product = {
  id: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
  productType: 'one_time';
};

export type Taxonomy = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  sortOrder?: number;
};

export type Script = {
  id: string;
  scriptCode: string;
  slug: string;
  title: string;
  situation: string;
  theySaid: string | null;
  badReply: string | null;
  betterReply: string;
  whyItWorks: string | null;
  alternativeResponse: string | null;
  nextMove: string | null;
  useThisWhen: string | null;
  category: Taxonomy | null;
  stage: Taxonomy | null;
  niches: Taxonomy[];
  sortOrder: number | null;
};

export type Resource = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  resourceType: string;
  externalUrl: string | null;
  storagePath: string | null;
  hasContent: boolean;
};

export type ResourceGuide = {
  eyebrow: string;
  intro: string;
  sections: Array<{
    title: string;
    copy: string;
    bullets?: string[];
  }>;
  searchPrompts: Array<{
    label: string;
    query: string;
  }>;
};

export type Entitlement = {
  active: boolean;
  product: Product | null;
  expiresAt: string | null;
};

export type PaymentStatus = {
  status: 'pending' | 'successful' | 'failed' | 'cancelled' | 'refunded';
  paidAt: string | null;
  amount: number;
  currency: string;
  accessActive: boolean;
};

export type BusinessContext = {
  id: string;
  userId: string;
  businessName: string;
  description: string | null;
  targetCustomer: string | null;
  differentiator: string | null;
  businessInformation: string | null;
  policies: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BusinessContextInput = {
  businessName: string;
  description: string;
  targetCustomer: string;
  differentiator: string;
  businessInformation: string;
  policies: string;
};

export type Offer = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  includedItems: string | null;
  benefits: string | null;
  deliveryInformation: string | null;
  terms: string | null;
  policies: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OfferInput = {
  name: string;
  description: string;
  price: number | null;
  currency: string;
  includedItems: string;
  benefits: string;
  deliveryInformation: string;
  terms: string;
  policies: string;
  isActive: boolean;
};

export type AiReplySession = {
  id: string;
  userId: string;
  customerMessage: string;
  conversationContext: string | null;
  businessContextId: string | null;
  offerId: string | null;
  recommendedScriptId: string | null;
  generatedReply: string | null;
  nextMove: string | null;
  createdAt: string;
};

export type AiReplySessionInput = {
  customerMessage: string;
  conversationContext: string;
  businessContextId: string | null;
  offerId: string | null;
};
