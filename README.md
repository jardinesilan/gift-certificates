# Gift Certificate App — Public Standalone (Unida Massage)

A publicly-hostable gift certificate purchase app. This is a standalone port of
the private `gift-certificate-app` web artifact: same look, same presets, same
flows — rebuilt as a plain Node/Express server with SQLite so it can run on
Railway, Render, or any host with a public URL.

**What it does**
- Public purchase flow: pick a preset + optional free-entry tip → buyer/recipient
  details → pay by **card through SumUp hosted checkout** or **Venmo QR**
  ("I've paid", trust-based, $0 fee) → certificate issued with a 5-character
  gift code (same format as the private app).
- On issuance it emails the **recipient gift email** and the **buyer receipt**
  (amount, tip, total, gift code) — same content as the private app.
- Certificates **never expire** (Washington law, RCW 19.240).
- Exposes a **sync API** so the private Muse side can pull newly issued
  certificates into Owner Tools (replaces the artifact's agent-task
  auto-registration).

**What it does NOT do** (stays in the private Muse apps)
- Redemption / balance lookup, Owner Tools register, Client Journal — those
  remain private. The sync API feeds Owner Tools.

## Run locally

```bash
cd gc-public-app
npm install
cp .env.example .env   # then fill in values (see below)
npm start               # http://localhost:3000
```

Without `SUMUP_API_KEY`, card checkout creation fails gracefully (the app tells
the buyer to try again). Without `RESEND_API_KEY`, emails are logged to the
console instead of being sent — safe for development.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SUMUP_API_KEY` | yes (for cards) | SumUp live API key (`sup_sk_live_…`). Read at runtime only — never commit it. |
| `SUMUP_MERCHANT_CODE` | yes | Ela's merchant code: `MCSUELG2` |
| `APP_BASE_URL` | yes (for cards) | Public base URL, e.g. `https://gifts.unidamassage.com`. SumUp redirects the buyer back to `<APP_BASE_URL>/return?purchase_id=<id>` after payment. |
| `RESEND_API_KEY` | for live email | Resend API key (`re_…`). Unset → console fallback. |
| `MAIL_FROM` | for live email | Verified sender, e.g. `Unida Massage <gifts@unidamassage.com>` (domain must be verified in Resend). |
| `SYNC_TOKEN` | for Owner Tools sync | Shared secret; the Muse cron sends `Authorization: Bearer <SYNC_TOKEN>`. Unset → sync API disabled (503). |
| `PORT` | no | Default `3000`. Railway/Render inject their own. |
| `DB_PATH` | no | Default `./data/gc.db`. Point at a persistent volume in production. |

## API

- `POST /api/purchases` — `{service_id, tip_amount_cents, buyer_name, buyer_email, recipient_name, recipient_email, message}` → creates a SumUp hosted checkout, returns `{purchase}` with `hosted_checkout_url`.
- `GET /api/purchases/:id` — `{purchase, certificate|null}` (used for polling).
- `POST /api/purchases/:id/verify` — verifies the SumUp checkout (`PAID` + matching id/merchant/reference/amount/currency) and issues the certificate. Idempotent: re-verifying an issued purchase returns the existing certificate (duplicate issuance is impossible).
- `POST /api/venmo/issue` — same body; issues immediately (trust-based).
- `GET /return?purchase_id=<id>` — buyer landing page after SumUp payment ("Check payment" UI).
- `GET /api/v1/certificates?since=<ISO8601>` — **Bearer `SYNC_TOKEN`**. Returns `{certificates: [{code, amount_cents, tip_cents, buyer_name, buyer_email, recipient_name, recipient_email, payment_method, payment_ref, checkout_reference, issued_at}]}` for everything issued at/after `since`. The Muse-side cron polls this and registers new codes in Owner Tools.

## Deploy

### Railway
1. Push this folder to a Git repo (do **not** commit `.env`).
2. Railway → New Project → Deploy from repo. It detects the `Dockerfile` automatically.
3. Add a **Volume** mounted at `/app/data` (keeps `gc.db` across restarts).
4. Set the env vars above in Railway → Variables.
5. Deploy. Set `APP_BASE_URL` to the Railway domain (or your custom domain).

### Render
1. Push to a Git repo (no `.env`).
2. Render → New → Web Service → select repo. Either:
   - **Docker**: Render detects the `Dockerfile`; or
   - **Native**: Build command `npm ci`, Start command `npm start`, add a **Disk** mounted at `/app/data` and set `DB_PATH=/app/data/gc.db`.
3. Set the env vars in Render → Environment.
4. Deploy. Set `APP_BASE_URL` to the Render URL (or custom domain).

### Wiring it to unidamassage.com
Point Ela's "Online Gift Certificate Offer" homepage section at the deployed URL
(a button/link, or an iframe embed). Airo (GoDaddy's AI builder) can add the
button — give it the deployed URL.

## Swapping SQLite → Postgres

All SQL lives in `src/db.js` behind small functions (`insertCertificate`,
`getPurchase`, `updatePurchase`, `insertEmailDelivery`, `listCertificatesSince`,
…), and `server.js` only calls those functions — so the swap is one module:

1. `npm install pg`, drop `better-sqlite3`.
2. Rewrite `src/db.js` with `pg`'s `Pool`, keeping the same exported function
   names and return shapes. Schema (Postgres DDL):
   ```sql
   CREATE TABLE certificates (
     id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
     original_amount_cents INT NOT NULL, tip_amount_cents INT NOT NULL DEFAULT 0,
     remaining_amount_cents INT NOT NULL,
     buyer_name TEXT NOT NULL, buyer_email TEXT NOT NULL,
     recipient_name TEXT NOT NULL, recipient_email TEXT NOT NULL,
     message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
     payment_method TEXT NOT NULL, payment_ref TEXT NOT NULL,
     sumup_checkout_id TEXT, sumup_transaction_code TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE TABLE pending_purchases (
     id SERIAL PRIMARY KEY, checkout_reference TEXT UNIQUE NOT NULL,
     service_id TEXT NOT NULL, amount_cents INT NOT NULL,
     tip_amount_cents INT NOT NULL DEFAULT 0, total_cents INT NOT NULL,
     buyer_name TEXT NOT NULL, buyer_email TEXT NOT NULL,
     recipient_name TEXT NOT NULL, recipient_email TEXT NOT NULL,
     message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'creating',
     sumup_checkout_id TEXT, hosted_checkout_url TEXT, sumup_status TEXT,
     sumup_transaction_code TEXT, failure_reason TEXT,
     certificate_id INT REFERENCES certificates(id),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE TABLE email_deliveries (
     id SERIAL PRIMARY KEY,
     certificate_id INT NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
     recipient_type TEXT NOT NULL, email TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'queued', failure_reason TEXT,
     sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   ```
3. Replace `?` placeholders with `$1, $2, …`, `lastInsertRowid` with
   `RETURNING id`, and ISO-string timestamps with real `timestamptz`
   (convert with `new Date(iso)` on read).
4. Set `DB_PATH` aside; use `DATABASE_URL` for the pool.

## Notes & limitations

- **Not yet verified live**: the SumUp create/verify calls are implemented
  against the API shapes proven by the private app on 2026-10-12, but no live
  checkout was created during this build (per instructions). Before going
  live: set the env vars, run one real low-value purchase end-to-end with
  Ela's email, and confirm both emails arrive.
- The "For you" vs "Gift for someone" distinction from the plan doesn't exist
  as a toggle in the current private app — it uses one form with "From you"
  and "For them" sections, which is what was ported.
- Venmo prices (in-person discount): 60min $70, 90min $105, 90min w/ cupping
  $110; 30min $40 and foot $50 unchanged. $0 processing fee.
- Rate limits: 60 req/min per IP on `/api`, 12 req/min on purchase/issue
  endpoints.
