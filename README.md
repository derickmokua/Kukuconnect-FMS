# KukuConnect FMS

**Farm Management System** for [KukuConnect](https://www.kukuconnect.co.ke) — poultry hatchery and chick sales in Kitui, Kenya.

Staff tools for inventory, brooder, incubation, sales, expenses, and farmer orders.  
Public low-data order form for customers. Branded PDF receipts and sales reports.

---

## Features

| Area | What it does |
|------|----------------|
| **Dashboard** | Live stock, pending orders, profit, finance chart (sales / expenses / net) |
| **Orders** | Farmer orders from the web form; confirm M-Pesa manually; fulfill; notify |
| **Sales** | Walk-in POS, stock deduction, branded till-slip PDF receipts |
| **Inventory** | SKUs, stock in/out, low-stock alerts, movement history |
| **Brooder** | Lot tracking, **daily age-up** (day-old → week → month), **mortality** (not sales) |
| **Incubation** | Batches, candling, hatch → day-old stock + brooder lot |
| **Expenses** | Feed, meds, labour, etc. · month totals for profit |
| **Notifications** | WhatsApp templates; optional Africa’s Talking SMS |
| **Settings** | Go-live checklist, opening stock, cloud migration |

**Data:** works offline in the browser (`localStorage`), or multi-device with **Supabase**.

---

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 4**
- **pdf-lib** (receipts & sales reports)
- **Supabase** (optional auth + Postgres)
- Deploy target: **Vercel**

---

## Quick start (local)

```bash
# Clone
git clone https://github.com/derickmokua/Kukuconnect-FMS.git
cd Kukuconnect-FMS

# Install
npm install

# Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Without env vars the app runs in **local-only** mode (single browser). That is fine for testing.

---

## Environment variables

Copy `.env.example` to `.env.local` (never commit real secrets).

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `NEXT_PUBLIC_SITE_URL` | For production | e.g. `https://app.kukuconnect.co.ke` |
| `NEXT_PUBLIC_MPESA_TILL` | For real orders | Till / paybill shown on `/order` |
| `NEXT_PUBLIC_STAFF_PHONE` | Optional | Staff SMS / WhatsApp contact (`2547…`) |
| `NEXT_PUBLIC_SUPABASE_URL` | For cloud | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | For cloud | Supabase anon key |
| `AFRICASTALKING_API_KEY` | Optional | SMS (server only) |
| `AFRICASTALKING_USERNAME` | Optional | e.g. `sandbox` or live username |
| `AFRICASTALKING_FROM` | Optional | Sender ID / shortcode |

---

## Optional: Supabase (multi-device)

1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor — run in order:
   - `supabase/schema.sql`
   - `supabase/orders.sql`
   - `supabase/sales_receipt_fields.sql` (optional receipt meta)
   - `supabase/brooder.sql` (optional brooder cloud tables)
3. Authentication → create a staff user (email + password).
4. Put URL + anon key in `.env.local` (or Vercel env).
5. Restart / redeploy. Sign in at `/login`.
6. **Settings** → upload local data to cloud if you already used offline mode.

Auth redirect URLs (production):

- Site URL: `https://app.kukuconnect.co.ke`
- Redirect: `https://app.kukuconnect.co.ke/**`

---

## Main routes

| Path | Who | Description |
|------|-----|-------------|
| `/` | Staff | Dashboard |
| `/orders` | Staff | Confirm / fulfill farmer orders |
| `/sales` | Staff | Record sales + PDF receipts + monthly report |
| `/inventory` | Staff | Stock levels |
| `/brooder` | Staff | Age-up + mortality |
| `/incubation` | Staff | Egg batches & hatch |
| `/expenses` | Staff | Costs |
| `/settings` | Staff | Go-live, migration, notify prefs |
| `/order` | **Public** | Farmer order form (share this link) |
| `/login` | Staff | Login when cloud mode is on |
| `/api/health` | — | Env readiness check (no secrets) |

---

## Deploy to Vercel + kukuconnect.co.ke

You already own **kukuconnect.co.ke** and can keep DNS at your registrar.  
**No need to buy another domain.**

### Recommended URLs

| URL | Project |
|-----|---------|
| `https://www.kukuconnect.co.ke` | Marketing website (existing) |
| `https://app.kukuconnect.co.ke` | **This FMS app** |

### Steps (summary)

1. Import this repo into **Vercel** as a **new** project (separate from marketing).
2. Set production env vars (see table above). Redeploy.
3. Vercel → Domains → add `app.kukuconnect.co.ke`.
4. At your **DNS host**, add:
   ```text
   Type: CNAME
   Name: app
   Value: cname.vercel-dns.com
   ```
   (Use the exact target Vercel shows if different.)
5. Wait for SSL. Test `/order` and staff login.
6. On the marketing site, link “Order chicks” → `https://app.kukuconnect.co.ke/order`.

**Detailed PDF guide** (same content, printable):

```text
docs/KukuConnect-Vercel-DNS-Guide.pdf
```

Regenerate the PDF:

```bash
node scripts/generate-dns-guide.mjs
```

---

## Scripts

```bash
npm run dev      # local development
npm run build    # production build
npm run start    # run production build
npm run lint     # ESLint
```

---

## Project structure (simple)

```text
src/
  app/           # Pages (dashboard, sales, orders, brooder, …)
  components/    # UI shell, forms, charts, logo
  lib/           # Business logic + localStorage / Supabase repos
public/          # logo.png, logo_transparent.png
supabase/        # SQL schema files
docs/            # PDF guides
scripts/         # PDF generators, helpers
```

---

## Daily staff flow

1. **Morning** — Dashboard / Brooder (age-up runs automatically).  
2. **Orders** — Confirm M-Pesa, notify farmer, fulfill when ready.  
3. **Walk-in sales** — Sales → receipt PDF.  
4. **Hatch** — Incubation → hatch → day-olds + brooder lot.  
5. **Mortality** — Brooder → record deaths (stock out as loss, not sale).  
6. **Evening** — Expenses (feed, meds, labour).

---

## License & contact

Private project for KukuConnect (Kenya).

- Website: [kukuconnect.co.ke](https://www.kukuconnect.co.ke)  
- Email: kukuconnect@outlook.com  

---

## Author

**Derick Mokua** · [github.com/derickmokua](https://github.com/derickmokua)
