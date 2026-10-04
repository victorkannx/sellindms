# Sell In DMs Customer Platform

A mobile-first customer application for the existing **Sell In DMs Core** Supabase product. It is built around the customer loop: search a DM situation, find an approved script, understand it, copy the response, and take the next move.

## Core guarantees

- Uses the existing Sell In DMs Supabase schema and the existing `sell-in-dms-core` product only.
- Never hard-codes, modifies, or duplicates approved script content.
- Relies on existing Supabase RLS for published-script and customer-owned record access.
- Requires both a Supabase Auth session and active `product_access` entitlement before `/app/*` can display the paid library.
- Uses the existing `search_scripts(query_text, result_limit)` full-text function for natural-language search.
- Keeps Flutterwave secrets server-only. Checkout success URLs do not grant access; the server verifies Flutterwave transactions before changing an order to `successful` and upserting the unique `(user_id, product_id)` access row.
- Generates AI replies only from the authenticated customer’s saved business context, owned active offer, current conversation, and 3–5 results from the existing script search; it never accepts browser-supplied user or context IDs.

## Required configuration

Use the secure project secret input flow for these values; do not put them in source files or browser code.

| Key | Used by |
|---|---|
| `SUPABASE_URL` | Server and browser-safe runtime configuration |
| `SUPABASE_ANON_KEY` | Browser-safe Supabase Auth and RLS client configuration |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only product lookup, pending order persistence, verified fulfillment, and signed resource links |
| `OPENAI_API_KEY` | Preferred server-only OpenAI credential for AI Reply generation |
| `OPENAI_API_BASE` | Optional OpenAI-compatible base URL for AI Reply generation |
| `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` | Alternative Manus server-side AI provider pair |
| `AI_REPLY_MODEL` | Optional server-side AI Reply model override; defaults to `gpt-5-mini` |
| `FLUTTERWAVE_SECRET_KEY` | Server-only Flutterwave checkout initialization and transaction verification |
| `FLUTTERWAVE_WEBHOOK_SECRET` | Server-only validation of the Flutterwave `verif-hash` webhook header |
| `APP_ORIGIN` | Browser-visible HTTPS origin used for the Supabase Auth callback and Flutterwave callback URL |
| `SUPABASE_RESOURCE_BUCKET` | Required only if an active resource uses `storage_path` instead of `external_url` |

After deployment, configure Flutterwave to send its webhook to:

```text
https://YOUR_APP_ORIGIN/api/payments/flutterwave/webhook
```

The webhook must include the Flutterwave `verif-hash` configured as `FLUTTERWAVE_WEBHOOK_SECRET`.

## Development

```bash
pnpm install
pnpm dev
```

The app listens on port `3000`. Health check: `GET /_app/health`.

```bash
pnpm typecheck
pnpm build
```

## AI Reply flow

`POST /api/ai-replies` is entitlement-gated and requires a bearer Supabase session. The server loads the authenticated user’s current business context and active offer, creates the input `ai_reply_sessions` row, searches the existing `search_scripts(query_text, result_limit)` function with the customer message plus conversation context, sends the returned script content to the configured server-side provider, validates the structured response, and finally updates the same owned session with `generated_reply`, `next_move`, and a verified recommended script ID. The browser never receives provider or Supabase service-role credentials.

When neither configured provider is present, the endpoint returns a truthful `503 AI_PROVIDER_NOT_CONFIGURED` response; it never returns fabricated reply content.

Provider output is treated as untrusted: the server rejects malformed or incomplete JSON, non-empty/length/schema violations, hidden/internal or credential-like content, contradictory claims, ungrounded sensitive business claims, and recommended script codes outside the server-retrieved published scripts. Customer and conversation text are passed as untrusted situation context, not instructions. On generation or validation failure, no reply is persisted or shown as if it were generated.

## Payment flow

1. The customer signs in using Supabase Auth; this links a pending order to an authenticated identity but does not grant library access.
2. The server creates a pending order for the existing product and initializes Flutterwave checkout.
3. Flutterwave callback/webhook sends a transaction ID.
4. The server independently verifies the transaction amount, currency, reference, and successful status with Flutterwave.
5. The server marks the matching order successful and activates/upserts the existing unique `product_access` record.
6. The browser checks the database-backed entitlement before opening the customer library.

## Production

The `Dockerfile` builds the Vite customer interface and starts the TypeScript Express server. Configure the Webdev deployment health path as `/_app/health` and preserve the server capability.
