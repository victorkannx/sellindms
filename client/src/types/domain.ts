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
