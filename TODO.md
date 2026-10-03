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

## 8. Start Here onboarding

- Add a customer-facing Start Here onboarding page inside the entitlement-gated `/app/*` experience without changing Supabase Auth, payment, entitlement, RLS, product content, or the existing 100 script records.
- Explain the exact 3-step workflow: **Find the situation → Use the response → Keep moving**.
- Include links to the existing search experience and relevant existing scripts, using live script slugs/IDs and not duplicating or rewriting script bodies.
- Preserve the existing Sell In DMs visual design system, navigation, and mobile-first behavior.

## 9. Customer resources

- Populate the existing `resources` table with exactly four useful active resources named **Sell In DMs Quick Reference**, **DM Conversation Map**, **Objection Handling Cheat Sheet**, and **What Do I Say? Decision Guide**; do not create a new table or duplicate/rewrite the 100 scripts.
- Make the Resources page display the four resources instead of an empty state and make each resource usable from a customer-facing mobile-first experience.
- Make resource listing and resource content accessible only to authenticated customers with an active Sell In DMs Core entitlement, without modifying RLS policies or weakening existing access checks.
- Keep resource records tied to the existing resources schema and existing access model; do not change payment, pricing, Flutterwave, Supabase Auth, product access, or product content logic.

## 10. Validation and preservation

- Validate Start Here rendering, the exact 3-step workflow, search links, existing script links, all four resource records and resource views, mobile layout, entitlement protection, existing search/library behavior, and absence of changes to the 100 script records, payment/auth/RLS logic, and product content.

## 11. Production UX/UI refinement

- Treat this as a UX/UI refinement pass only; do not change Supabase schema, Supabase RLS, authentication, Flutterwave/payment logic, product/access/entitlement logic, existing script content, search backend, resources/content data, database relationships, payment callbacks/webhooks, or existing working functionality.
- Preserve the current Sell In DMs visual identity: warm off-white background, black typography, muted gold/brown accent, minimal editorial aesthetic, clean borders, and restrained visual hierarchy; do not add gradients, stock imagery, excessive animation, decorative illustrations everywhere, unnecessary icons, excessive shadows, complicated dashboards, or gamification.
- Increase desktop and mobile whitespace without making everything huge: more main-content horizontal padding, more vertical separation between major sections, more internal card padding, more space between headings/descriptions/controls, 20–24px mobile page padding, approximately 40–56px mobile major-section separation, and breathable card spacing.
- Use a highly readable modern sans-serif UI system with Manrope for large headings/display typography and Inter for body copy, navigation, metadata, buttons, and controls; keep editorial large headings but reduce oversized mobile headings, improve line-height, avoid overly tight letter spacing, and make small labels subtle.
- Replace the persistent mobile bottom navigation with a compact top mobile header showing the Sell In DMs logo/wordmark and a menu icon; the menu opens a polished one-hand-friendly drawer/popover with Home, Start Here, Search, Browse Library, Saved, Recent, Resources, and Account; it has a clear close button, closes when an item is selected, closes when tapping outside, opens smoothly, and does not remove desktop sidebar navigation.
- Keep a consistent compact sticky/fixed mobile header across authenticated application routes without putting every navigation link directly in the header.
- Redesign library cards for scanability: prioritize stage/category, script title, 1–2 line situation description with ellipsis, niche information, an easy-to-tap Open action, and favorite action; use breathable grid cards on desktop and focused single-column tappable cards on mobile; keep full information on script detail pages.
- Redesign the library filter area as a clear filtering/navigation system; keep stages, categories, and niches, use horizontally scrollable filter chips on mobile where appropriate, and avoid overwhelming the initial viewport.
- Keep the Start Here three-step concept exactly as Find the situation → Use the response → Keep moving, give each section more breathing room, make hierarchy clear, communicate that customers do not need to memorize 100 scripts, and keep the existing useful first-script cards.
- Improve script detail spacing between title, situation, They Said, Don’t Send This, Sell In DMs Reply, Why It Works, Next Move, Use This When, Alternative Response, Relevant For, and Related Scripts; keep Sell In DMs Reply strongest, Copy Response prominent, response text easy to read/copy on mobile, and related scripts framed as the next conversation step.
- Keep the four existing resources; make resource rows/cards spacious and readable, make the title strongest, description secondary, Open guide clear but restrained, and stack mobile resource content naturally.
- Apply the same card and typography improvements to Saved and Recent; keep useful empty states, including “Save scripts you know you’ll want again.” with a clear Browse Library link when Saved is empty.
- Do not change the search backend; improve presentation with examples such as “How much?”, “They said it’s too expensive”, “They stopped replying”, “I need to think about it”, and “Can you reduce the price?” so the UI supports the future natural-language intelligence direction without adding AI now.
- Verify responsive behavior at 320px, 360px, 375px, 390px, 412px, 768px, 1024px, and desktop for horizontal overflow, cramped cards, oversized headings, wrapping buttons, collisions, navigation, filter overflow, resource actions, and script-response readability.
- After implementation, run typecheck and production build; verify existing routes, authentication and entitlement protection, 100 published scripts, search, favorites, recently viewed, all four resources for entitled customers, desktop sidebar, new mobile popup navigation including Resources, and that no payment/auth/backend logic was unintentionally changed.

## 12. Systematic typography, spacing, and readability refinement

- Treat this as a visual-polish pass only: do not redesign the product or change page structure, navigation, copy, functionality, component hierarchy, database, search logic, routes, authentication, payment flow, Supabase schema/RLS, entitlement logic, existing script content, resources/content data, or working behavior.
- Make **Manrope** the primary font across Sell In DMs and apply a calm, consistent hierarchy: primary page headings at weight 600 with desktop scale about 56–68px and mobile scale about 44–50px; section headings at weight 600 with desktop scale about 40–48px and mobile scale about 32–38px; card/script titles at weight 600 with desktop scale about 28–32px and mobile scale about 25–30px; body copy at weight 400, approximately 17–18px where space allows, and 1.6–1.7 line-height; uppercase labels at weight 600, 12–13px, and 0.12–0.16em letter-spacing; buttons/actions at weight 600 without unnecessarily heavy text.
- Preserve the warm off-white, charcoal/black, muted gold/brown, soft-grey, and white-surface identity; avoid pure black for body/interface text, retain accessible contrast, subtle borders, editorial rectangular cards, and only very soft shadows where needed. Do not add gradients, stock imagery, rounded SaaS cards, visual clutter, or flashy treatment.
- Apply a consistent spacing scale across landing, checkout, `/app`, Start Here, search, library, browse results, script detail pages, resources, Saved, Recent, account, and authenticated customer pages. Increase the rhythm between labels/headings, headings/descriptions, descriptions/search, search/suggestions, section headers/cards, card title/description/action, and detail panels. Use 16–24px mobile horizontal padding and comfortable major-section breathing room without becoming wasteful.
- Refine existing search field, suggestion chips, script result cards, Stage/Category/Niche filter chips, Start Here, detail response panels, resources, Saved/Recent, and account styling for calmer reading and fast scanning. Preserve all existing search, filtering, favorite, recent-viewed, resource, and access behavior exactly.
- Keep mobile first: use responsive type scales rather than simply shrinking desktop values, prevent horizontal overflow, maintain readable response text and touch targets, keep mobile filter rows intentionally horizontally scrollable, and ensure headings remain bold but not visually overwhelming at 320px, 360px, 375px, 390px, 412px, 768px, 1024px, and desktop.
- Validate TypeScript, production build, visual layout checks, page/route availability, entitlement protection, the existing 100 published scripts, existing search, favorites, recently viewed, four active resources, desktop sidebar, mobile drawer navigation, and absence of changes to payment/Auth/database/backend files.
