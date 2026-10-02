# Sell In DMs Customer Platform — Implementation Checklist

## 1. Foundation, live data contract, and secure project setup

- Inspect the existing **Sell In DMs** Supabase schema, relationships, RLS policies, functions, indexes, and active existing product record before application code depends on it.
- Do **not** create a new Supabase project; recreate, delete, overwrite, rename, or duplicate existing tables; re-import scripts; create a duplicate product; or modify, paraphrase, summarize, or hard-code the 100 approved scripts.
- Generate/derive application types and data adapters from the inspected schema, preserve RLS, configure TypeScript diagnostics before application code, publish a complete `/manus-routes.json` route declaration, and keep browser-safe configuration separate from server-only secrets.
- Use the live Sell In DMs Core product (`sell-in-dms-core`, NGN 7,500, one-time) as the only checkout product.

## 2. Public product experience and responsive visual system

- Build `/` as a modern, minimal, premium, practical, conversion-focused landing page in dark grey, black, white, neutral grey, and a restrained accent; use strong typography, whitespace, subtle borders, rounded cards, and no stock photos, fake social proof, fake urgency, counters, generic AI styling, neon, cartoon art, fake metrics, glassmorphism, or excessive animation.
- Include the exact hero headline “Stop losing sales because you don't know what to say next.”; supporting copy “Sell In DMs gives you practical scripts for turning everyday conversations into customers without sounding desperate, robotic, or pushy.”; primary CTA “Get Sell In DMs”; secondary CTA “See How It Works”; problem, three-step workflow, an actual-library-powered reply comparison where available, realistic product component previews, real implemented inclusions, audiences, practical FAQ without invented policies, and final CTA.
- Deliver a mobile-first application shell with desktop sidebar navigation (Dashboard, Search, Browse, Saved, Recent, Resources, Account), mobile navigation (Home, Search, Saved, Library, Account), obvious path back to search, readable scripts, accessible copy action, and tested tablet/desktop/mobile states.

## 3. Authentication, route protection, and entitlement enforcement

- Use Supabase Auth and protect every `/app/*` customer route.
- Permit paid script-library access only when the visitor is authenticated and has an active `product_access` record for Sell In DMs Core; an authenticated user without active access must not access paid scripts.
- Never grant access because a customer saw a success URL, clicked a button, supplied query parameters, has localStorage state, or is assumed paid by frontend code. Do not bypass RLS from the browser, expose a service-role key, trust client-provided payment/order/access/role state, or expose admin functionality.
- Provide useful failed-authentication, expired-session, missing-access, unavailable-script, network, and recovery states.

## 4. Live customer dashboard, search, and dynamic browse experience

- Build `/app` with Sell In DMs, “What do you need help with?”, a large “Search your DM situation...” field, supplied natural-language examples, Quick Help cards, dynamic Browse by Stage and Browse by Category, and user-specific Saved/Recently Viewed modules with useful empty states.
- Build `/app/search`, `/app/scripts`, `/app/category/[slug]`, `/app/stage/[slug]`, and `/app/niche/[slug]` using existing live Supabase records, pagination where appropriate, and existing relationships.
- Use the existing `search_scripts(query_text, result_limit)`/full-text search infrastructure rather than preloading all scripts or implementing a competing search system. Support situation, customer-message, and combined natural-language searches. Return only published, non-archived scripts with live title, situation, category, stage, relevant niche where present, short preview, and favorite state.
- Keep Quick Help mappings data-driven through existing records, relationships, keywords, or search results; never duplicate script bodies in the frontend.

## 5. Script field guide, favorites, recent history, activity, and resources

- Build `/app/scripts/[slug]` as a readable practical field guide using only stored fields: title, situation, customer message, bad reply marked “Don't send this”, better reply as the primary “Sell In DMs Reply”, Why It Works, Alternative Response when available, Next Move, Use This When, actual niche examples only where stored, and related scripts via `related_scripts`.
- Copy the stored response through the clipboard API, show “Copied” feedback, and handle failure transparently. Record a real `SCRIPT_COPIED` activity event only when the existing schema supports it.
- Use existing `favorites` for current-user favorite/unfavorite and `/app/saved`; use `recently_viewed` to upsert a current-user/current-script view, increment `view_count`, update `last_viewed_at`, avoid duplicate rows, and show `/app/recent`.
- Write only meaningful actual customer activity events and never fake events. Build `/app/resources` from existing active resource records only, enabling `storage_path` downloads or `external_url` links only when they exist; otherwise show useful truthful empty states.

## 6. Secure existing-product checkout and Flutterwave entitlement flow

- Build `/checkout` with live Sell In DMs Core product/price, full name, email, Flutterwave payment method, accessible validation, and pending/failed/cancelled/verification/success experiences.
- Implement server-side Flutterwave initiation, verified webhook/callback handling, transaction verification, amount/currency/reference matching, and idempotent existing-order status management (`pending`, `successful`, `failed`, `cancelled`, `refunded`). Keep Flutterwave secret keys and webhook configuration server-only.
- Grant/activate the existing unique `product_access` record only after verified successful Flutterwave payment updates the existing order. Payment verification failure, failure, cancellation, or an untrusted browser success state must never grant product access.
- Make onboarding/account linking use the actual configured Supabase Auth options after verified purchase; do not create unauthenticated library access. If required Flutterwave credentials or webhook setup are absent, identify the exact secure configuration rather than simulating payment success.

## 7. Performance, validation, production readiness, and handoff

- Keep primary interactions fast through server-side queries, indexed existing search infrastructure, efficient joins, lazy secondary content, and pagination; do not load all scripts client-side merely to search.
- Validate landing/checkout product display, protected routes, entitlement persistence after refresh, live search for “stopped replying”, “how much”, and “expensive”, actual script rendering, copy action, favorites, recently viewed, published/archive filtering, responsive navigation/search/detail/checkout/authentication states, and absence of private credentials from browser output.
- Resolve TypeScript and build diagnostics, provide server health endpoint and Docker production contract, preserve truthful no-fake-data behavior, and report any non-configurable Supabase RLS or missing payment credential blocker precisely.
