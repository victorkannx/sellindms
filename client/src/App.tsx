import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppSidebar, Brand, Chip, EmptyState, formatNaira, LoadingState, MobileNav, ScriptCard, SearchForm } from './components/ui';
import {
  deleteOffer,
  getBusinessContext,
  getEntitlement,
  getFavoriteIds,
  getOffers,
  getPublicProduct,
  getRecentlyViewed,
  getRelatedScripts,
  getResourceGuide,
  getResources,
  getSavedScripts,
  getScriptBySlug,
  getScriptsByIds,
  getTaxonomy,
  listScripts,
  recordCopied,
  saveBusinessContext,
  saveOffer,
  searchScripts,
  setOfferActive,
  toggleFavorite,
  trackScriptView,
} from './lib/data';
import { getAuthCallbackUrl, getSupabase } from './lib/supabase';
import type { BusinessContext, BusinessContextInput, Entitlement, Offer, OfferInput, PaymentStatus, Product, Resource, ResourceGuide, Script, Taxonomy } from './types/domain';

type CustomerContextValue = {
  supabase: SupabaseClient;
  user: User;
  entitlement: Entitlement;
  refreshEntitlement: () => Promise<void>;
};

const CustomerContext = createContext<CustomerContextValue | null>(null);

const useCustomer = () => {
  const value = useContext(CustomerContext);
  if (!value) throw new Error('Customer context is unavailable.');
  return value;
};

const quickHelp = [
  ['Someone asked my price', 'someone asked my price'],
  ["They said it's expensive", 'they said expensive'],
  ['They want a discount', 'client wants discount'],
  ['They stopped replying', 'someone stopped replying'],
  ["They'll think about it", "they'll think about it"],
  ['They want more information', 'send me more information'],
  ["They're comparing me with someone else", 'someone else is cheaper'],
  ["They aren't ready", 'not ready to buy'],
  ['They need to ask their partner', 'need to ask my husband'],
  ['They want to buy', 'ready to buy'],
  ['They already bought', 'after sale'],
] as const;

const startHereScriptIds = [
  'b9170e1a-b032-4955-82fe-54d07f724bb8',
  'a8b0b9bd-c21f-476f-9b86-61c7c4a19731',
  'f3831b56-ae1f-4706-87e1-6d86739590e9',
];

const searchExamples = [
  ['How much?', 'how much'],
  ["They said it's too expensive", 'they said expensive'],
  ['They stopped replying', 'they stopped replying'],
  ['I need to think about it', 'i need to think about it'],
  ['Can you reduce the price?', 'can you reduce the price'],
] as const;

function SearchExamples({ onSearch }: { onSearch: (query: string) => void }) {
  return <div className="search-examples search-examples--search"><span>Try:</span>{searchExamples.map(([label, query]) => <button key={label} type="button" onClick={() => onSearch(query)}>{label}</button>)}</div>;
}

const apiError = async (response: Response) => {
  const body = await response.json().catch(() => null);
  const error = body?.error;
  const configuration = Array.isArray(error?.required) && error.required.length ? ` Required: ${error.required.join(', ')}.` : '';
  throw new Error(`${error?.message || 'The request could not be completed.'}${configuration}`);
};

function App() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(false);
  const [configurationError, setConfigurationError] = useState<string | null>(null);

  const refreshEntitlement = useCallback(async () => {
    if (!supabase || !user) {
      setEntitlement(null);
      return;
    }
    setAccessLoading(true);
    try {
      setEntitlement(await getEntitlement(supabase));
    } catch (error) {
      setEntitlement({ active: false, product: null, expiresAt: null });
      setConfigurationError(error instanceof Error ? error.message : 'Access could not be confirmed.');
    } finally {
      setAccessLoading(false);
    }
  }, [supabase, user]);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: () => void = () => {};
    getSupabase()
      .then(async (client) => {
        if (!mounted) return;
        setSupabase(client);
        const { data } = await client.auth.getSession();
        if (mounted) setUser(data.session?.user ?? null);
        const listener = client.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
        unsubscribe = () => listener.data.subscription.unsubscribe();
      })
      .catch((error) => {
        if (mounted) setConfigurationError(error instanceof Error ? error.message : 'Supabase configuration is unavailable.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    void refreshEntitlement();
  }, [refreshEntitlement]);

  const customerValue = useMemo<CustomerContextValue | null>(() => (
    supabase && user && entitlement ? { supabase, user, entitlement, refreshEntitlement } : null
  ), [supabase, user, entitlement, refreshEntitlement]);

  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing configurationError={configurationError} />} />
        <Route path="/checkout" element={<Checkout supabase={supabase} user={user} entitlement={entitlement} accessLoading={accessLoading} configurationError={configurationError} refreshEntitlement={refreshEntitlement} />} />
        <Route path="/payment/success" element={<PaymentResult supabase={supabase} user={user} successful />} />
        <Route path="/payment/failed" element={<PaymentResult supabase={supabase} user={user} successful={false} />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/app/*" element={<CustomerGate loading={loading} accessLoading={accessLoading} user={user} entitlement={entitlement} configurationError={configurationError} customerValue={customerValue} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previousRestoration; };
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    root.style.scrollBehavior = previousBehavior;
  }, [location.key, location.pathname, location.search]);
  return null;
}

function Landing({ configurationError }: { configurationError: string | null }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  useEffect(() => {
    getPublicProduct().then(setProduct).catch((error) => setProductError(error instanceof Error ? error.message : 'Product information is unavailable.'));
  }, []);

  return (
    <main className="marketing">
      <header className="marketing-nav shell">
        <Brand inverted />
        <div className="marketing-nav__actions">
          <a href="#how-it-works">How it works</a>
          <Link className="button button--small button--light" to="/checkout">Get Sell In DMs <span>→</span></Link>
        </div>
      </header>

      <section className="hero shell">
        <div className="hero__copy">
          <div className="eyebrow eyebrow--light"><span /> Practical DM sales system</div>
          <h1>Stop losing sales because you <em>don&apos;t know</em> what to say next.</h1>
          <p>Sell In DMs gives you practical scripts for turning everyday conversations into customers without sounding desperate, robotic, or pushy.</p>
          <div className="hero__actions">
            <Link className="button button--accent" to="/checkout">Get Sell In DMs <span>→</span></Link>
            <a className="text-link text-link--light" href="#how-it-works">See how it works <span>↓</span></a>
          </div>
          <p className="hero__note">One-time access. Use the library when the conversation is happening.</p>
        </div>
        <div className="hero__tool" aria-label="Product interface preview">
          <div className="tool-bar"><span /><span /><span /><b>SELL IN DMs</b></div>
          <div className="tool-content">
            <span className="tool-label">WHAT HAPPENED?</span>
            <div className="tool-search">⌕&nbsp;&nbsp; Someone stopped replying after asking for the price</div>
            <div className="tool-results">
              <div className="tool-result tool-result--featured"><span>FOLLOW UP</span><strong>Find the next move.</strong><p>Search the situation. Open the relevant script. Keep the conversation clear.</p><i>→</i></div>
              <div className="tool-result"><span>FIELD GUIDE</span><strong>Copy when ready.</strong></div>
            </div>
          </div>
          <div className="tool-footer">Search&nbsp;&nbsp;&nbsp; Find&nbsp;&nbsp;&nbsp; Read&nbsp;&nbsp;&nbsp; Copy&nbsp;&nbsp;&nbsp; Use</div>
        </div>
      </section>

      <section className="principle shell"><span>01</span><blockquote>“Don&apos;t try to force the conversation toward a sale. Try to move the conversation toward clarity.”</blockquote></section>

      <section className="problem shell">
        <div className="section-kicker">THE REAL PROBLEM</div>
        <div className="split-heading"><h2>Interest is there. Then the conversation gets <em>awkward.</em></h2><p>Someone asks a question. You don&apos;t know what to say. You pitch too early, write too much, discount immediately, chase them, or stop responding altogether.</p></div>
        <div className="problem-lines"><span>Someone shows interest.</span><span>They ask a question.</span><span>You need the next move.</span></div>
      </section>

      <section id="how-it-works" className="steps shell">
        <div className="section-kicker">HOW IT WORKS</div>
        <div className="steps__grid">
          <article><span>01</span><h3>Find the situation</h3><p>Search what the person said or what happened.</p></article>
          <article><span>02</span><h3>Get the response</h3><p>See the recommended response and why it works.</p></article>
          <article><span>03</span><h3>Keep it moving</h3><p>Use the next move and related scripts.</p></article>
        </div>
      </section>

      <section className="compare shell">
        <div className="compare__header"><div><div className="section-kicker">A BETTER NEXT MOVE</div><h2>Don&apos;t fill the silence with a <em>pitch.</em></h2></div><p>When someone asks about price, clarity beats pressure. The library helps you respond to the moment—not talk over it.</p></div>
        <div className="compare__cards">
          <article className="reply-block reply-block--avoid"><span>DON&apos;T SEND THIS</span><p>“Yes, I can help. The price is ₦50,000. Let me know if you&apos;re interested.”</p><small>A price drop without context can end the conversation.</small></article>
          <article className="reply-block reply-block--better"><span>SELL IN DMs RESPONSE</span><p>Open the approved response built for the situation, understand why it works, then copy it when it fits.</p><small>Real replies load from the paid script library—never from generic filler.</small></article>
        </div>
      </section>

      <section className="included shell">
        <div><div className="section-kicker">WHAT&apos;S INSIDE</div><h2>A field guide for the conversations that matter.</h2>{product ? <p className="price-note">{product.name} · {formatNaira(product.price)} · One-time access</p> : <p className="price-note">{productError || configurationError || 'Product details load securely from Supabase.'}</p>}</div>
        <div className="included__list">
          {['100 practical DM scripts', 'Search by real situation', 'Objection handling & follow-up', 'Stage, category & niche browsing', 'Favorites & recently viewed', 'Active downloadable resources'].map((item, index) => <div key={item}><span>0{index + 1}</span><p>{item}</p><b>↗</b></div>)}
        </div>
      </section>

      <section className="audience shell"><div className="section-kicker">BUILT FOR PEOPLE WHO SELL IN CONVERSATIONS</div><div className="audience__list">{['Coaches', 'Consultants', 'Freelancers', 'Agencies', 'Creators', 'Real estate', 'Digital products', 'E-commerce', 'Service businesses'].map((audience) => <span key={audience}>{audience}</span>)}</div></section>

      <section className="faq shell"><div><div className="section-kicker">PRACTICAL QUESTIONS</div><h2>No course to study before you can use it.</h2></div><div className="faq__list">
        <details open><summary>What is Sell In DMs?<b>+</b></summary><p>A searchable, practical DM sales system for finding the right response to what is happening in a conversation.</p></details>
        <details><summary>Is this a course?<b>+</b></summary><p>No. It is a working script library designed to be opened while you are actively selling in DMs.</p></details>
        <details><summary>Can I search by the situation?<b>+</b></summary><p>Yes. Search what they said, what happened, or the objection you are handling.</p></details>
        <details><summary>Can I save useful scripts?<b>+</b></summary><p>Yes. Save scripts to return to them quickly, and your recently viewed scripts stay easy to find.</p></details>
        <details><summary>How does access work?<b>+</b></summary><p>After a verified purchase, access is linked to your authenticated account. Your access is checked from the product entitlement—not from a success page.</p></details>
      </div></section>

      <section className="final-cta"><div className="shell"><span className="final-cta__mark">↳</span><p>SELL IN DMs</p><h2>Stop wondering what to say next.</h2><Link className="button button--accent" to="/checkout">Get Sell In DMs <span>→</span></Link></div></section>
      <footer className="marketing-footer shell"><Brand /><p>Practical responses for real DM conversations.</p></footer>
    </main>
  );
}

function AuthPanel({ supabase, purpose = 'continue' }: { supabase: SupabaseClient | null; purpose?: string }) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return setError('Supabase authentication is not configured yet.');
    setError(null);
    try {
      const authCallbackUrl = await getAuthCallbackUrl();
      const { error: authError } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: authCallbackUrl, shouldCreateUser: true } });
      if (authError) throw authError;
      setSubmitted(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'We could not send that sign-in link.');
    }
  };
  if (submitted) return <div className="auth-success"><span>✓</span><h3>Check your inbox.</h3><p>We sent a secure sign-in link to <strong>{email}</strong>. Return here after you open it.</p></div>;
  return <form className="auth-form" onSubmit={submit}><label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><button className="button button--accent" type="submit">Email me a sign-in link <span>→</span></button><p>Sign in to {purpose}. This does not grant library access—access is verified separately.</p>{error && <div className="form-error">{error}</div>}</form>;
}

function Checkout({ supabase, user, entitlement, accessLoading, configurationError, refreshEntitlement }: { supabase: SupabaseClient | null; user: User | null; entitlement: Entitlement | null; accessLoading: boolean; configurationError: string | null; refreshEntitlement: () => Promise<void> }) {
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getPublicProduct().then(setProduct).catch((reason) => setProductError(reason instanceof Error ? reason.message : 'Product information is unavailable.')); }, []);
  useEffect(() => { if (user?.user_metadata?.full_name) setFullName(String(user.user_metadata.full_name)); }, [user]);

  const startPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !user) return;
    setSubmitting(true); setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error('Your sign-in session has expired. Please sign in again.');
      const response = await fetch('/api/checkout/flutterwave', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ fullName, email: user.email }) });
      if (!response.ok) await apiError(response);
      const body = await response.json() as { paymentUrl: string };
      window.location.assign(body.paymentUrl);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Payment could not be started.'); } finally { setSubmitting(false); }
  };

  if (accessLoading) return <PageFrame><LoadingState label="Checking account access" /></PageFrame>;
  if (entitlement?.active) return <PageFrame><div className="access-message"><span>✓</span><h1>Your library is ready.</h1><p>This account already has verified access to Sell In DMs Core.</p><Link className="button button--accent" to="/app">Open your library <span>→</span></Link></div></PageFrame>;

  return <PageFrame><div className="checkout-layout"><section className="checkout-intro"><Brand /><div><span className="eyebrow">ONE-TIME ACCESS</span><h1>Keep your next conversation <em>clear.</em></h1><p>Start with a secure sign-in. Payment is completed through Flutterwave, and access is granted only after the payment is verified server-side.</p></div><div className="checkout-points"><span>✓ Live product entitlement check</span><span>✓ Secure Flutterwave payment</span><span>✓ Searchable customer library</span></div></section><section className="checkout-card"><div className="checkout-card__product"><div><span>PRODUCT</span><h2>{product?.name || 'Sell In DMs Core'}</h2></div><strong>{product ? formatNaira(product.price) : '—'}</strong></div>{productError && <div className="form-error">{productError}</div>}{configurationError && <div className="form-error">{configurationError}</div>}{!user ? <><div className="checkout-card__heading"><span>01</span><div><p>SECURE ACCOUNT</p><h2>Sign in first</h2></div></div><AuthPanel supabase={supabase} purpose="connect payment to your account" /></> : <form onSubmit={startPayment}><div className="checkout-card__heading"><span>02</span><div><p>PAYMENT DETAILS</p><h2>Ready to pay securely</h2></div></div><label className="field-label">Full name<input required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" /></label><label className="field-label">Email<input value={user.email || ''} disabled /></label><div className="payment-method"><div><b>FLW</b><span><strong>Flutterwave</strong><small>Secure one-time payment</small></span></div><i>Selected</i></div><button disabled={!product || submitting} className="button button--accent button--full" type="submit">{submitting ? 'Connecting to Flutterwave…' : `Pay ${product ? formatNaira(product.price) : ''}`} <span>→</span></button><p className="checkout-card__legal">A payment success screen alone never grants access. Your entitlement is checked after Flutterwave verification.</p>{error && <div className="form-error">{error}</div>}<button type="button" className="quiet-button checkout-card__signout" onClick={async () => { await supabase?.auth.signOut(); await refreshEntitlement(); navigate('/checkout'); }}>Use a different account</button></form>}</section></div></PageFrame>;
}

function PaymentResult({ supabase, user, successful }: { supabase: SupabaseClient | null; user: User | null; successful: boolean }) {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [loading, setLoading] = useState(successful);
  const [error, setError] = useState<string | null>(null);
  const reference = params.get('reference');
  const check = useCallback(async () => {
    if (!successful || !reference || !supabase || !user) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error('Sign in again to check this payment.');
      const response = await fetch(`/api/payments/status?reference=${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${data.session.access_token}` } });
      if (!response.ok) await apiError(response);
      setStatus(await response.json() as PaymentStatus);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Payment status could not be checked.'); } finally { setLoading(false); }
  }, [reference, successful, supabase, user]);
  useEffect(() => { void check(); }, [check]);

  if (successful && !user) return <PageFrame><div className="access-message"><span>↳</span><h1>One more secure step.</h1><p>Payment returns are not proof of access. Sign in to check the verified payment status attached to your account.</p><AuthPanel supabase={supabase} purpose="check your payment status" /></div></PageFrame>;
  if (!successful) return <PageFrame><div className="access-message"><span>×</span><h1>Payment wasn&apos;t completed.</h1><p>No access has been granted. You can return to checkout whenever you&apos;re ready.</p><Link className="button button--accent" to="/checkout">Return to checkout <span>→</span></Link></div></PageFrame>;
  if (loading) return <PageFrame><LoadingState label="Checking verified payment status" /></PageFrame>;
  if (error) return <PageFrame><div className="access-message"><span>!</span><h1>We couldn&apos;t verify that yet.</h1><p>{error}</p><button className="button button--accent" onClick={() => void check()}>Check again <span>↻</span></button></div></PageFrame>;
  if (status?.status === 'successful' && status.accessActive) return <PageFrame><div className="access-message"><span>✓</span><h1>Your access is ready.</h1><p>Flutterwave payment has been verified and your Sell In DMs Core entitlement is active.</p><Link className="button button--accent" to="/app">Open your library <span>→</span></Link></div></PageFrame>;
  return <PageFrame><div className="access-message"><span>…</span><h1>Your payment is still being checked.</h1><p>The library remains locked until the server verifies your Flutterwave transaction and activates the database entitlement.</p><button className="button button--accent" onClick={() => void check()}>Check status <span>↻</span></button></div></PageFrame>;
}

function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const hashError = hashParams.get('error_description') || hashParams.get('error');
        if (hashError) {
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
          throw new Error('This sign-in link could not be completed. Request a fresh link and try again.');
        }
        const supabase = await getSupabase();
        const code = new URLSearchParams(window.location.search).get('code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }
        const { data } = await supabase.auth.getSession();
        if (data.session) navigate('/checkout', { replace: true });
        else setError('The sign-in link did not create a session. Request a new link and try again.');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Authentication could not be completed.');
      }
    })();
  }, [navigate]);
  return <PageFrame><div className="access-message"><span>{error ? '!' : '↳'}</span><h1>{error ? 'Sign-in needs another try.' : 'Signing you in…'}</h1><p>{error || 'Finishing secure Supabase authentication.'}</p>{error && <Link className="button button--accent" to="/checkout">Return to checkout <span>→</span></Link>}</div></PageFrame>;
}

function CustomerGate({ loading, accessLoading, user, entitlement, configurationError, customerValue }: { loading: boolean; accessLoading: boolean; user: User | null; entitlement: Entitlement | null; configurationError: string | null; customerValue: CustomerContextValue | null }) {
  const location = useLocation();
  if (loading || accessLoading) return <PageFrame><LoadingState label="Checking secure library access" /></PageFrame>;
  if (!user) return <Navigate to={`/checkout?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (!entitlement?.active || !customerValue) return <PageFrame><div className="access-message"><span>↳</span><h1>Access required.</h1><p>{configurationError || 'This signed-in account does not have an active Sell In DMs Core entitlement yet.'}</p><Link className="button button--accent" to="/checkout">Go to checkout <span>→</span></Link></div></PageFrame>;
  return <CustomerContext.Provider value={customerValue}><CustomerArea /></CustomerContext.Provider>;
}

function CustomerArea() {
  const { supabase } = useCustomer();
  const navigate = useNavigate();
  const signOut = async () => { await supabase.auth.signOut(); navigate('/'); };
  return <div className="customer-app"><AppSidebar onSignOut={() => void signOut()} /><main className="app-canvas"><Routes><Route index element={<Dashboard />} /><Route path="start-here" element={<StartHerePage />} /><Route path="sales-context" element={<SalesContextPage />} /><Route path="search" element={<SearchPage />} /><Route path="scripts" element={<LibraryPage />} /><Route path="scripts/:slug" element={<ScriptDetailPage />} /><Route path="category/:slug" element={<BrowsePage kind="category" />} /><Route path="stage/:slug" element={<BrowsePage kind="stage" />} /><Route path="niche/:slug" element={<BrowsePage kind="niche" />} /><Route path="saved" element={<SavedPage />} /><Route path="recent" element={<RecentPage />} /><Route path="resources" element={<ResourcesPage />} /><Route path="resources/:slug" element={<ResourceGuidePage />} /><Route path="account" element={<AccountPage onSignOut={signOut} />} /><Route path="*" element={<Navigate to="/app" replace />} /></Routes></main><MobileNav /></div>;
}

function PageHeader({ eyebrow, title, copy, children }: { eyebrow?: string; title: ReactNode; copy?: string; children?: ReactNode }) { return <header className="page-header">{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{copy && <p>{copy}</p>}{children}</header>; }

type BusinessContextForm = BusinessContextInput;
type OfferForm = Omit<OfferInput, 'price'> & { price: string };

const emptyBusinessContextForm = (): BusinessContextForm => ({ businessName: '', description: '', targetCustomer: '', differentiator: '', businessInformation: '', policies: '' });
const emptyOfferForm = (): OfferForm => ({ name: '', description: '', price: '', currency: 'NGN', includedItems: '', benefits: '', deliveryInformation: '', terms: '', policies: '', isActive: false });
const businessContextToForm = (context: BusinessContext): BusinessContextForm => ({ businessName: context.businessName, description: context.description || '', targetCustomer: context.targetCustomer || '', differentiator: context.differentiator || '', businessInformation: context.businessInformation || '', policies: context.policies || '' });
const offerToForm = (offer: Offer): OfferForm => ({ name: offer.name, description: offer.description || '', price: offer.price === null ? '' : String(offer.price), currency: offer.currency || 'NGN', includedItems: offer.includedItems || '', benefits: offer.benefits || '', deliveryInformation: offer.deliveryInformation || '', terms: offer.terms || '', policies: offer.policies || '', isActive: offer.isActive });

function SalesContextPage() {
  const { supabase, user } = useCustomer();
  const [context, setContext] = useState<BusinessContext | null>(null);
  const [businessForm, setBusinessForm] = useState<BusinessContextForm>(emptyBusinessContextForm);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offerForm, setOfferForm] = useState<OfferForm>(emptyOfferForm);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [offerEditorOpen, setOfferEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [savingOffer, setSavingOffer] = useState(false);
  const [offerActionId, setOfferActionId] = useState<string | null>(null);
  const [businessError, setBusinessError] = useState<string | null>(null);
  const [businessSuccess, setBusinessSuccess] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [offerSuccess, setOfferSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [savedContext, savedOffers] = await Promise.all([getBusinessContext(supabase, user), getOffers(supabase, user)]);
      setContext(savedContext);
      setBusinessForm(savedContext ? businessContextToForm(savedContext) : emptyBusinessContextForm());
      setOffers(savedOffers);
    } catch (reason) {
      setBusinessError(reason instanceof Error ? reason.message : 'Business information could not load.');
      setOfferError(reason instanceof Error ? reason.message : 'Offers could not load.');
    } finally {
      setLoading(false);
    }
  }, [supabase, user]);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeOffer = offers.find((offer) => offer.isActive) || null;
  const status = !context && !activeOffer
    ? 'Not set up'
    : context && !activeOffer
      ? 'Business information saved'
      : 'Ready for AI replies';

  const saveBusiness = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusinessError(null);
    setBusinessSuccess(null);
    if (!businessForm.businessName.trim()) {
      setBusinessError('Business name is required.');
      return;
    }
    setSavingBusiness(true);
    try {
      const saved = await saveBusinessContext(supabase, user, businessForm, context?.id);
      setContext(saved);
      setBusinessForm(businessContextToForm(saved));
      setBusinessSuccess('Business information saved.');
    } catch (reason) {
      setBusinessError(reason instanceof Error ? reason.message : 'Business information could not be saved.');
    } finally {
      setSavingBusiness(false);
    }
  };

  const beginOffer = (offer?: Offer) => {
    setOfferError(null);
    setOfferSuccess(null);
    setEditingOfferId(offer?.id || null);
    setOfferForm(offer ? offerToForm(offer) : emptyOfferForm());
    setOfferEditorOpen(true);
  };

  const cancelOffer = () => {
    setEditingOfferId(null);
    setOfferForm(emptyOfferForm());
    setOfferError(null);
    setOfferEditorOpen(false);
  };

  const saveCurrentOffer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOfferError(null);
    setOfferSuccess(null);
    if (!offerForm.name.trim()) {
      setOfferError('Offer name is required.');
      return;
    }
    const parsedPrice = offerForm.price.trim() === '' ? null : Number(offerForm.price);
    if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      setOfferError('Price must be zero or greater.');
      return;
    }
    const existing = offers.find((offer) => offer.id === editingOfferId);
    const input: OfferInput = { ...offerForm, price: parsedPrice };
    setSavingOffer(true);
    try {
      const saved = await saveOffer(supabase, user, input, existing?.id, existing?.isActive || false);
      if (input.isActive) await setOfferActive(supabase, user, saved.id, true);
      await refresh();
      setOfferSuccess(existing ? 'Offer updated.' : 'Offer added.');
      setEditingOfferId(null);
      setOfferForm(emptyOfferForm());
      setOfferEditorOpen(false);
    } catch (reason) {
      setOfferError(reason instanceof Error ? reason.message : 'Offer could not be saved.');
      await refresh().catch(() => undefined);
    } finally {
      setSavingOffer(false);
    }
  };

  const changeOfferActiveState = async (offer: Offer) => {
    setOfferError(null);
    setOfferSuccess(null);
    setOfferActionId(offer.id);
    try {
      await setOfferActive(supabase, user, offer.id, !offer.isActive);
      await refresh();
      setOfferSuccess(offer.isActive ? 'Offer deactivated.' : 'Active offer updated.');
    } catch (reason) {
      setOfferError(reason instanceof Error ? reason.message : 'Offer status could not be updated.');
      await refresh().catch(() => undefined);
    } finally {
      setOfferActionId(null);
    }
  };

  const removeOffer = async (offer: Offer) => {
    if (!window.confirm(`Delete “${offer.name}”? This does not affect previous purchases, orders, or payment records.`)) return;
    setOfferError(null);
    setOfferSuccess(null);
    setOfferActionId(offer.id);
    try {
      await deleteOffer(supabase, user, offer.id);
      if (editingOfferId === offer.id) cancelOffer();
      await refresh();
      setOfferSuccess('Offer deleted.');
    } catch (reason) {
      setOfferError(reason instanceof Error ? reason.message : 'Offer could not be deleted.');
    } finally {
      setOfferActionId(null);
    }
  };

  const displayPrice = (offer: Offer) => {
    if (offer.price === null) return null;
    try {
      return new Intl.NumberFormat('en-NG', { style: 'currency', currency: offer.currency || 'NGN', maximumFractionDigits: 2 }).format(offer.price);
    } catch {
      return `${offer.currency || 'NGN'} ${offer.price}`;
    }
  };

  return <div className="sales-context-page">
    <PageHeader eyebrow="PRIVATE SETUP" title={<>AI Sales <em>Context</em></>} copy="Give Sell In DMs the context it needs to help you respond like you actually know your business." />
    <p className="sales-context-page__supporting">Your business and offer information is saved securely and can be reused whenever you use the AI reply assistant.</p>

    <section className="context-status" aria-live="polite">
      <div><span className="eyebrow">CONTEXT STATUS</span><strong>{status}</strong></div>
      <p>Informational only. No AI replies are generated on this page.</p>
    </section>

    <section className="context-panel">
      <div className="context-panel__heading"><div><span className="eyebrow">YOUR BUSINESS</span><h2>Business Information</h2></div></div>
      {!loading && !context && <div className="context-empty-hint"><strong>Tell us about your business</strong><p>The more useful context you give us, the more relevant your future AI replies can be.</p></div>}
      {loading ? <LoadingState label="Loading your business information" /> : <form className="context-form" onSubmit={saveBusiness}>
        <label className="context-field context-field--full">Business name *<input required value={businessForm.businessName} onChange={(event) => setBusinessForm((current) => ({ ...current, businessName: event.target.value }))} placeholder="Your business name" /></label>
        <label className="context-field">What do you sell?<textarea value={businessForm.description} onChange={(event) => setBusinessForm((current) => ({ ...current, description: event.target.value }))} placeholder="Describe your product or service" /></label>
        <label className="context-field">Who do you serve?<textarea value={businessForm.targetCustomer} onChange={(event) => setBusinessForm((current) => ({ ...current, targetCustomer: event.target.value }))} placeholder="Describe the people you serve" /></label>
        <label className="context-field">What makes your offer different?<textarea value={businessForm.differentiator} onChange={(event) => setBusinessForm((current) => ({ ...current, differentiator: event.target.value }))} placeholder="Your differentiator or point of view" /></label>
        <label className="context-field">Other important business information<textarea value={businessForm.businessInformation} onChange={(event) => setBusinessForm((current) => ({ ...current, businessInformation: event.target.value }))} placeholder="Anything else that makes a response more useful" /></label>
        <label className="context-field context-field--full">Policies / things the AI should know<textarea value={businessForm.policies} onChange={(event) => setBusinessForm((current) => ({ ...current, policies: event.target.value }))} placeholder="Boundaries, promises, policies, or details to keep in mind" /></label>
        {businessError && <div className="form-error context-field--full" role="alert">{businessError}</div>}
        {businessSuccess && <div className="form-success context-field--full" role="status">{businessSuccess}</div>}
        <div className="context-form__actions context-field--full"><button className="button button--accent" type="submit" disabled={savingBusiness}>{savingBusiness ? 'Saving business information…' : 'Save Business Information'} <span>→</span></button></div>
      </form>}
    </section>

    <section className="context-panel context-panel--offers">
      <div className="context-panel__heading"><div><span className="eyebrow">WHAT YOU SELL</span><h2>Offers</h2></div><button className="button button--outline" type="button" onClick={() => beginOffer()}>{offers.length ? 'Add Offer' : 'Add Your First Offer'} <span>+</span></button></div>
      {offerError && <div className="form-error" role="alert">{offerError}</div>}
      {offerSuccess && <div className="form-success" role="status">{offerSuccess}</div>}
      {offerEditorOpen && <form className="offer-editor" onSubmit={saveCurrentOffer}>
        <div className="offer-editor__heading"><div><span className="eyebrow">{editingOfferId ? 'EDIT OFFER' : 'NEW OFFER'}</span><h3>{editingOfferId ? 'Update this offer' : 'Add an offer'}</h3></div><button type="button" className="quiet-button" onClick={cancelOffer}>Cancel</button></div>
        <div className="context-form">
          <label className="context-field context-field--full">Offer name *<input required value={offerForm.name} onChange={(event) => setOfferForm((current) => ({ ...current, name: event.target.value }))} placeholder="Name of your product or service" /></label>
          <label className="context-field">What is it?<textarea value={offerForm.description} onChange={(event) => setOfferForm((current) => ({ ...current, description: event.target.value }))} placeholder="A short description" /></label>
          <div className="offer-price-row"><label className="context-field">Price<input type="number" min="0" step="0.01" value={offerForm.price} onChange={(event) => setOfferForm((current) => ({ ...current, price: event.target.value }))} placeholder="Optional" /></label><label className="context-field">Currency<input value={offerForm.currency} onChange={(event) => setOfferForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} placeholder="NGN" maxLength={8} /></label></div>
          <label className="context-field">What&apos;s included?<textarea value={offerForm.includedItems} onChange={(event) => setOfferForm((current) => ({ ...current, includedItems: event.target.value }))} placeholder="Deliverables, inclusions, or scope" /></label>
          <label className="context-field">Key benefits<textarea value={offerForm.benefits} onChange={(event) => setOfferForm((current) => ({ ...current, benefits: event.target.value }))} placeholder="The outcomes customers care about" /></label>
          <label className="context-field">Delivery information<textarea value={offerForm.deliveryInformation} onChange={(event) => setOfferForm((current) => ({ ...current, deliveryInformation: event.target.value }))} placeholder="Timeline, format, or fulfilment details" /></label>
          <label className="context-field">Terms<textarea value={offerForm.terms} onChange={(event) => setOfferForm((current) => ({ ...current, terms: event.target.value }))} placeholder="Terms or limitations" /></label>
          <label className="context-field context-field--full">Policies<textarea value={offerForm.policies} onChange={(event) => setOfferForm((current) => ({ ...current, policies: event.target.value }))} placeholder="Offer-specific policies" /></label>
          <label className="active-offer-toggle context-field--full"><input type="checkbox" checked={offerForm.isActive} onChange={(event) => setOfferForm((current) => ({ ...current, isActive: event.target.checked }))} /><span><strong>Active offer</strong><small>Only one offer can be active at a time.</small></span></label>
        </div>
        <div className="context-form__actions"><button className="button button--accent" type="submit" disabled={savingOffer}>{savingOffer ? 'Saving offer…' : editingOfferId ? 'Save Offer' : 'Add Offer'} <span>→</span></button><button className="button button--outline" type="button" onClick={cancelOffer}>Cancel</button></div>
      </form>}
      {loading ? <LoadingState label="Loading offers" /> : offers.length ? <div className="offer-list">{offers.map((offer) => <article key={offer.id} className="offer-card"><div className="offer-card__heading"><div><div className="offer-card__meta"><span className={`offer-status ${offer.isActive ? 'is-active' : ''}`}>{offer.isActive ? 'Active' : 'Inactive'}</span>{displayPrice(offer) && <strong>{displayPrice(offer)}</strong>}</div><h3>{offer.name}</h3>{offer.description && <p>{offer.description}</p>}</div></div><div className="offer-card__actions"><button className="button button--outline button--small" type="button" onClick={() => beginOffer(offer)}>Edit</button><button className="button button--outline button--small" type="button" disabled={offerActionId === offer.id} onClick={() => void changeOfferActiveState(offer)}>{offerActionId === offer.id ? 'Saving…' : offer.isActive ? 'Deactivate' : 'Set Active'}</button><button className="offer-delete" type="button" disabled={offerActionId === offer.id} onClick={() => void removeOffer(offer)}>Delete</button></div></article>)}</div> : !offerEditorOpen && <EmptyState title="No offers yet" action={<button className="button button--accent" type="button" onClick={() => beginOffer()}>Add Your First Offer <span>→</span></button>}>Add the product or service you usually sell in conversations.</EmptyState>}
    </section>
  </div>;
}

function Dashboard() {
  const { supabase, user } = useCustomer();
  const navigate = useNavigate();
  const [state, setState] = useState<{ recent: Array<{ script: Script; lastViewedAt: string; viewCount: number }>; saved: Script[]; taxonomy: { stages: Taxonomy[]; categories: Taxonomy[]; niches: Taxonomy[] } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { Promise.all([getRecentlyViewed(supabase), getSavedScripts(supabase), getTaxonomy(supabase)]).then(([recent, saved, taxonomy]) => setState({ recent, saved, taxonomy })).catch((reason) => setError(reason instanceof Error ? reason.message : 'Dashboard data could not load.')); }, [supabase]);
  return <><PageHeader eyebrow="SELL IN DMs" title={<>What do you need <em>help with?</em></>} copy="Search what happened in the conversation. Find the right next move." /><SearchForm onSearch={(query) => navigate(`/app/search?q=${encodeURIComponent(query)}`)} /><SearchExamples onSearch={(query) => navigate(`/app/search?q=${encodeURIComponent(query)}`)} /><section className="app-section"><div className="section-heading"><div><span className="eyebrow">QUICK HELP</span><h2>Start where the conversation is.</h2></div></div><div className="quick-help">{quickHelp.map(([label, query], index) => <button key={label} onClick={() => navigate(`/app/search?q=${encodeURIComponent(query)}`)}><span>0{index + 1}</span><strong>{label}</strong><b>→</b></button>)}</div></section>{error && <div className="form-error">{error}</div>}<section className="app-section app-section--two"><div><div className="section-heading"><div><span className="eyebrow">BROWSE BY STAGE</span><h2>Follow the sale.</h2></div><Link to="/app/scripts" className="text-link">View all <span>→</span></Link></div><div className="taxonomy-list">{state?.taxonomy.stages.slice(0, 6).map((stage) => <Link key={stage.id} to={`/app/stage/${stage.slug}`}><span>{String(stage.sortOrder ?? 0).padStart(2, '0')}</span>{stage.name}<b>→</b></Link>) || <LoadingState label="Loading stages" />}</div></div><div><div className="section-heading"><div><span className="eyebrow">YOUR LIBRARY</span><h2>Keep close.</h2></div></div>{state?.saved.length ? <div className="mini-list">{state.saved.slice(0, 3).map((script) => <Link key={script.id} to={`/app/scripts/${script.slug}`}><span>★</span><div><strong>{script.title}</strong><small>{script.category?.name || 'Script'}</small></div><b>→</b></Link>)}</div> : <EmptyState title="Nothing saved yet.">Your saved scripts will appear here.<br /><Link className="text-link" to="/app/scripts">Browse the library <span>→</span></Link></EmptyState>}</div></section><section className="app-section"><div className="section-heading"><div><span className="eyebrow">RECENTLY VIEWED</span><h2>Pick up where you left off.</h2></div><Link to="/app/recent" className="text-link">View history <span>→</span></Link></div>{state?.recent.length ? <div className="script-grid">{state.recent.slice(0, 3).map(({ script }) => <ScriptCard key={script.id} script={script} />)}</div> : <EmptyState title="No scripts viewed yet.">Scripts you open will appear here.</EmptyState>}</section></>;
}

function StartHerePage() {
  const { supabase } = useCustomer();
  const [scripts, setScripts] = useState<Script[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getScriptsByIds(supabase, startHereScriptIds).then(setScripts).catch((reason) => { setError(reason instanceof Error ? reason.message : 'Starter scripts could not load.'); setScripts([]); }); }, [supabase]);
  return <><PageHeader eyebrow="START HERE" title={<>A calmer way to find the <em>next message.</em></>} copy="You do not need to memorise 100 scripts. Use the library in the moment, when the conversation is happening." /><section className="start-steps"><article><span>01</span><div><small>FIND THE SITUATION</small><h2>Find the situation.</h2><p>Search what they said or what just happened. Start with their words, not the response you wish you had.</p><Link className="text-link" to="/app/search">Search the library <span>→</span></Link></div></article><article><span>02</span><div><small>USE THE RESPONSE</small><h2>Use the response.</h2><p>Open the closest matching script. Read the reply, why it works, and the next move before you send anything.</p><Link className="text-link" to="/app/scripts">Browse all scripts <span>→</span></Link></div></article><article><span>03</span><div><small>KEEP MOVING</small><h2>Keep moving.</h2><p>When the conversation changes, search the new moment. A follow-up, question, or objection deserves its own next move.</p><Link className="text-link" to="/app/search?q=follow%20up">Find a follow-up <span>→</span></Link></div></article></section><section className="app-section"><div className="section-heading"><div><span className="eyebrow">START WITH A REAL MOMENT</span><h2>Open a useful first script.</h2></div><Link to="/app/resources" className="text-link">Open resources <span>→</span></Link></div>{error && <div className="form-error">{error}</div>}{scripts === null ? <LoadingState label="Loading starter scripts" /> : scripts.length ? <div className="script-grid script-grid--search">{scripts.map((script) => <ScriptCard key={script.id} script={script} />)}</div> : <EmptyState title="Starter scripts are unavailable.">Search the library for the live situation instead.<br /><Link className="text-link" to="/app/search">Search scripts <span>→</span></Link></EmptyState>}</section></>;
}

function SearchPage() {
  const { supabase, user } = useCustomer();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const query = params.get('q') || '';
  const [scripts, setScripts] = useState<Script[] | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const runSearch = useCallback(async (value: string) => { setScripts(null); setError(null); try { const [found, saved] = await Promise.all([searchScripts(supabase, value), getFavoriteIds(supabase)]); setScripts(found); setFavorites(saved); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Search failed.'); setScripts([]); } }, [supabase]);
  useEffect(() => { void runSearch(query); }, [query, runSearch]);
  const save = async (script: Script) => { try { const next = await toggleFavorite(supabase, user, script.id, favorites.has(script.id)); setFavorites((current) => { const update = new Set(current); next ? update.add(script.id) : update.delete(script.id); return update; }); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update saved scripts.'); } };
  return <><PageHeader eyebrow="SCRIPT SEARCH" title={query ? <>Results for <em>“{query}”</em></> : <>Find the <em>next move.</em></>} copy="Search what they said, what happened, or the objection you are handling." /><SearchForm initialValue={query} onSearch={(value) => navigate(`/app/search?q=${encodeURIComponent(value)}`)} /><SearchExamples onSearch={(value) => navigate(`/app/search?q=${encodeURIComponent(value)}`)} />{error && <div className="form-error">{error}</div>}{scripts === null ? <LoadingState label="Searching the approved library" /> : scripts.length ? <div className="script-grid script-grid--search">{scripts.map((script) => <ScriptCard key={script.id} script={script} saved={favorites.has(script.id)} onSave={save} />)}</div> : <EmptyState title="We couldn&apos;t find that exact situation.">Try fewer words, search what they actually said, or try “expensive”, “discount”, or “follow up”.</EmptyState>}</>;
}

function LibraryPage() {
  const { supabase, user } = useCustomer();
  const [state, setState] = useState<{ scripts: Script[]; taxonomy: { stages: Taxonomy[]; categories: Taxonomy[]; niches: Taxonomy[] }; favorites: Set<string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { Promise.all([listScripts(supabase, { limit: 36 }), getTaxonomy(supabase), getFavoriteIds(supabase)]).then(([scripts, taxonomy, favorites]) => setState({ scripts, taxonomy, favorites })).catch((reason) => setError(reason instanceof Error ? reason.message : 'Library data could not load.')); }, [supabase]);
  const save = async (script: Script) => { if (!state) return; try { const saved = await toggleFavorite(supabase, user, script.id, state.favorites.has(script.id)); setState((current) => { if (!current) return current; const next = new Set(current.favorites); saved ? next.add(script.id) : next.delete(script.id); return { ...current, favorites: next }; }); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update saved scripts.'); } };
  return <><PageHeader eyebrow="THE LIBRARY" title={<>Browse the <em>approved</em> responses.</>} copy="Every script is sourced from the live Sell In DMs library and filtered by entitlement." /><section className="browse-rail"><div><span>STAGES</span>{state?.taxonomy.stages.map((item) => <Link key={item.id} to={`/app/stage/${item.slug}`}>{item.name}</Link>)}</div><div><span>CATEGORIES</span>{state?.taxonomy.categories.map((item) => <Link key={item.id} to={`/app/category/${item.slug}`}>{item.name}</Link>)}</div><div><span>NICHES</span>{state?.taxonomy.niches.map((item) => <Link key={item.id} to={`/app/niche/${item.slug}`}>{item.name}</Link>)}</div></section>{error && <div className="form-error">{error}</div>}{state ? <div className="script-grid script-grid--search">{state.scripts.map((script) => <ScriptCard key={script.id} script={script} saved={state.favorites.has(script.id)} onSave={save} />)}</div> : <LoadingState label="Loading library" />}</>;
}

function BrowsePage({ kind }: { kind: 'category' | 'stage' | 'niche' }) {
  const { slug = '' } = useParams();
  const { supabase, user } = useCustomer();
  const [state, setState] = useState<{ label: Taxonomy; scripts: Script[]; favorites: Set<string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { (async () => { try { const taxonomy = await getTaxonomy(supabase); const source = kind === 'category' ? taxonomy.categories : kind === 'stage' ? taxonomy.stages : taxonomy.niches; const label = source.find((item) => item.slug === slug); if (!label) { setState(null); return; } const filter = kind === 'category' ? { categoryId: label.id } : kind === 'stage' ? { stageId: label.id } : { nicheId: label.id }; const [scripts, favorites] = await Promise.all([listScripts(supabase, { ...filter, limit: 48 }), getFavoriteIds(supabase)]); setState({ label, scripts, favorites }); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Browse data could not load.'); } })(); }, [kind, slug, supabase]);
  const save = async (script: Script) => { if (!state) return; try { const saved = await toggleFavorite(supabase, user, script.id, state.favorites.has(script.id)); setState((current) => { if (!current) return current; const next = new Set(current.favorites); saved ? next.add(script.id) : next.delete(script.id); return { ...current, favorites: next }; }); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update saved scripts.'); } };
  const label = kind === 'category' ? 'CATEGORY' : kind === 'stage' ? 'STAGE' : 'NICHE';
  if (error) return <><PageHeader eyebrow={label} title="We couldn&apos;t load this view." /><div className="form-error">{error}</div></>;
  if (!state) return <LoadingState label={`Loading ${label.toLowerCase()}`} />;
  return <><PageHeader eyebrow={label} title={<>{state.label.name} <em>scripts.</em></>} copy={state.label.description || 'Relevant approved responses from the live library.'} />{state.scripts.length ? <div className="script-grid script-grid--search">{state.scripts.map((script) => <ScriptCard key={script.id} script={script} saved={state.favorites.has(script.id)} onSave={save} />)}</div> : <EmptyState title="Nothing here yet.">No published scripts are currently available in this view.</EmptyState>}</>;
}

function ScriptDetailPage() {
  const { slug = '' } = useParams();
  const { supabase, user } = useCustomer();
  const [script, setScript] = useState<Script | null | undefined>(undefined);
  const [related, setRelated] = useState<Script[]>([]);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tracked = useRef<string | null>(null);
  useEffect(() => { (async () => { setScript(undefined); setError(null); try { const current = await getScriptBySlug(supabase, slug); setScript(current); if (!current) return; const [relations, favorites] = await Promise.all([getRelatedScripts(supabase, current.id), getFavoriteIds(supabase)]); setRelated(relations); setSaved(favorites.has(current.id)); if (tracked.current !== current.id) { tracked.current = current.id; void trackScriptView(supabase, user, current.id).catch(() => undefined); } } catch (reason) { setError(reason instanceof Error ? reason.message : 'This script could not be loaded.'); setScript(null); } })(); }, [slug, supabase, user]);
  const favorite = async () => { if (!script) return; try { setSaved(await toggleFavorite(supabase, user, script.id, saved)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update saved scripts.'); } };
  const copy = async () => { if (!script) return; try { await navigator.clipboard.writeText(script.betterReply); setCopied(true); void recordCopied(supabase, user, script.id).catch(() => undefined); window.setTimeout(() => setCopied(false), 2200); } catch { setError('Copy failed. Select the response text and copy it manually.'); } };
  if (script === undefined) return <LoadingState label="Opening script" />;
  if (!script) return <><PageHeader eyebrow="SCRIPT" title="This script isn&apos;t available." /><EmptyState title="No available script.">It may have been removed, archived, or your access may have changed.<br /><Link className="text-link" to="/app/search">Back to search <span>→</span></Link></EmptyState></>;
  return <article className="script-detail"><header className="detail-header"><div><Link className="back-link" to="/app/search">← Back to search</Link><div className="detail-tags">{script.stage && <Chip>{script.stage.name}</Chip>}{script.category && <Chip>{script.category.name}</Chip>}</div><h1>{script.title}</h1><p>{script.situation}</p></div><button className={`save-button ${saved ? 'is-saved' : ''}`} onClick={favorite}>{saved ? '★ Saved' : '☆ Save script'}</button></header>{error && <div className="form-error">{error}</div>}{script.theySaid && <section className="field-panel field-panel--said"><span>THEY SAID</span><blockquote>“{script.theySaid}”</blockquote></section>}{script.badReply && <section className="field-panel field-panel--avoid"><span>DON&apos;T SEND THIS</span><p>{script.badReply}</p></section>}<section className="field-panel field-panel--reply"><div><span>SELL IN DMs REPLY</span><button className="copy-button" onClick={copy}>{copied ? '✓ Copied' : 'Copy response'}</button></div><p>{script.betterReply}</p><small>Use the wording as a starting point, then keep it true to your offer and the conversation.</small></section><div className="detail-notes">{script.whyItWorks && <section><span>WHY IT WORKS</span><p>{script.whyItWorks}</p></section>}{script.nextMove && <section><span>NEXT MOVE</span><p>{script.nextMove}</p></section>}{script.useThisWhen && <section><span>USE THIS WHEN</span><p>{script.useThisWhen}</p></section>}{script.alternativeResponse && <section><span>ALTERNATIVE RESPONSE</span><p>{script.alternativeResponse}</p></section>}</div>{script.niches.length > 0 && <section className="niche-strip"><span>RELEVANT FOR</span>{script.niches.map((niche) => <Link key={niche.id} to={`/app/niche/${niche.slug}`}>{niche.name}</Link>)}</section>}{related.length > 0 && <section className="app-section"><div className="section-heading"><div><span className="eyebrow">RELATED SCRIPTS</span><h2>Keep the conversation moving.</h2></div></div><div className="script-grid">{related.map((item) => <ScriptCard key={item.id} script={item} />)}</div></section>}</article>;
}

function SavedPage() { const { supabase } = useCustomer(); const [scripts, setScripts] = useState<Script[] | null>(null); const [error, setError] = useState<string | null>(null); useEffect(() => { getSavedScripts(supabase).then(setScripts).catch((reason) => { setError(reason instanceof Error ? reason.message : 'Saved scripts could not load.'); setScripts([]); }); }, [supabase]); return <><PageHeader eyebrow="SAVED SCRIPTS" title={<>Your <em>go-to</em> responses.</>} copy="Keep useful responses close for the conversations you have most often." />{error && <div className="form-error">{error}</div>}{scripts === null ? <LoadingState label="Loading saved scripts" /> : scripts.length ? <div className="script-grid script-grid--search">{scripts.map((script) => <ScriptCard key={script.id} script={script} />)}</div> : <EmptyState title="No saved scripts yet.">Save scripts you know you'll want again.<br /><Link className="text-link" to="/app/scripts">Browse Library <span>→</span></Link></EmptyState>}</> }

function RecentPage() { const { supabase } = useCustomer(); const [items, setItems] = useState<Array<{ script: Script; lastViewedAt: string; viewCount: number }> | null>(null); const [error, setError] = useState<string | null>(null); useEffect(() => { getRecentlyViewed(supabase).then(setItems).catch((reason) => { setError(reason instanceof Error ? reason.message : 'Recent history could not load.'); setItems([]); }); }, [supabase]); return <><PageHeader eyebrow="RECENTLY VIEWED" title={<>Continue where you <em>left off.</em></>} copy="Scripts you open are saved here for quick return." />{error && <div className="form-error">{error}</div>}{items === null ? <LoadingState label="Loading recent scripts" /> : items.length ? <div className="script-grid script-grid--search">{items.map(({ script, viewCount }) => <div key={script.id} className="recent-card"><ScriptCard script={script} /><span>{viewCount} {viewCount === 1 ? 'view' : 'views'}</span></div>)}</div> : <EmptyState title="No scripts viewed yet.">Scripts you open will appear here.<br /><Link className="text-link" to="/app/search">Find a script <span>→</span></Link></EmptyState>}</> }

function ResourcesPage() { const { supabase } = useCustomer(); const [resources, setResources] = useState<Resource[] | null>(null); const [error, setError] = useState<string | null>(null); useEffect(() => { getResources(supabase).then(setResources).catch((reason) => { setError(reason instanceof Error ? reason.message : 'Resources could not load.'); setResources([]); }); }, [supabase]); return <><PageHeader eyebrow="RESOURCES" title={<>Useful tools, <em>ready in the moment.</em></>} copy="These practical references are available to active Sell In DMs Core customers." />{error && <div className="form-error">{error}</div>}{resources === null ? <LoadingState label="Loading resources" /> : resources.length ? <div className="resource-list">{resources.map((resource, index) => <article key={resource.id}><span>{String(index + 1).padStart(2, '0')}</span><div><small>{resource.resourceType.replaceAll('_', ' ')}</small><h2>{resource.title}</h2><p>{resource.description || 'A practical Sell In DMs resource.'}</p></div><ResourceAction resource={resource} supabase={supabase} /></article>)}</div> : <EmptyState title="No resources available yet.">Your active library does not have any available resources right now.</EmptyState>}</> }

function ResourceAction({ resource, supabase }: { resource: Resource; supabase: SupabaseClient }) { const [error, setError] = useState<string | null>(null); if (resource.hasContent) return <Link className="button button--outline" to={`/app/resources/${resource.slug}`}>Open guide <span>→</span></Link>; const download = async () => { try { const { data } = await supabase.auth.getSession(); if (!data.session?.access_token) throw new Error('Sign in again to download this resource.'); const response = await fetch(`/api/resources/${encodeURIComponent(resource.slug)}/download`, { headers: { Authorization: `Bearer ${data.session.access_token}` } }); if (!response.ok) await apiError(response); const payload = await response.json() as { downloadUrl?: string }; if (!payload.downloadUrl) throw new Error('The download URL could not be created.'); window.location.assign(payload.downloadUrl); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The download could not start.'); } }; if (!resource.externalUrl && !resource.storagePath) return <span className="unavailable">Unavailable</span>; return <div><button className="button button--outline" onClick={download}>{resource.externalUrl ? 'Open resource' : 'Download'} <span>{resource.externalUrl ? '↗' : '↓'}</span></button>{error && <div className="form-error">{error}</div>}</div> }

function ResourceGuidePage() { const { slug = '' } = useParams(); const { supabase } = useCustomer(); const [state, setState] = useState<{ resource: Resource; guide: ResourceGuide } | null | undefined>(undefined); const [error, setError] = useState<string | null>(null); useEffect(() => { setState(undefined); setError(null); getResourceGuide(supabase, slug).then(setState).catch((reason) => { setError(reason instanceof Error ? reason.message : 'This resource could not load.'); setState(null); }); }, [slug, supabase]); if (state === undefined) return <LoadingState label="Opening resource" />; if (!state) return <><PageHeader eyebrow="RESOURCE" title="This resource isn&apos;t available." /><EmptyState title="No available resource.">It may be inactive or your access may have changed.<br /><Link className="text-link" to="/app/resources">Back to resources <span>→</span></Link></EmptyState></>; return <article className="guide-detail"><header className="detail-header"><div><Link className="back-link" to="/app/resources">← Back to resources</Link><span className="eyebrow">{state.guide.eyebrow}</span><h1>{state.resource.title}</h1><p>{state.guide.intro}</p></div></header>{error && <div className="form-error">{error}</div>}<div className="guide-panels">{state.guide.sections.map((section, index) => <section key={section.title} className="guide-panel"><span>{String(index + 1).padStart(2, '0')}</span><div><h2>{section.title}</h2><p>{section.copy}</p>{section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}</div></section>)}</div><section className="guide-actions"><div><span className="eyebrow">SEARCH THE LIVE LIBRARY</span><h2>Use a response that matches the moment.</h2></div><div>{state.guide.searchPrompts.map((prompt) => <Link key={prompt.query} to={`/app/search?q=${encodeURIComponent(prompt.query)}`}>{prompt.label}<b>→</b></Link>)}</div></section></article> }

function AccountPage({ onSignOut }: { onSignOut: () => Promise<void> }) { const { user, entitlement } = useCustomer(); return <><PageHeader eyebrow="ACCOUNT" title={<>Your access, <em>kept clear.</em></>} copy="Account details and product access are checked from Supabase—not from this screen." /><section className="account-card"><div><span>EMAIL</span><p>{user.email}</p></div><div><span>PRODUCT ACCESS</span><p>{entitlement.active ? 'Sell In DMs Core — Active' : 'No active access'}</p></div><div><span>ACCESS TYPE</span><p>One-time product entitlement</p></div><button className="button button--outline" onClick={() => void onSignOut()}>Sign out <span>→</span></button></section></> }

function PageFrame({ children }: { children: ReactNode }) { return <main className="simple-page"><header className="simple-page__header"><Brand /></header><div className="simple-page__content">{children}</div></main>; }

export default App;
