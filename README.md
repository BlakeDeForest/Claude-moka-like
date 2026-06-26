# Claude-moka-like

A local order tracker for trading-card / toy retailer orders, inspired by
[mokatracker.app](https://mokatracker.app/). It reads order-confirmation emails,
normalizes each product into a canonical **SKU**, and renders a
**grouped-by-SKU** dark UI showing quantity, subtotal, order total, **order
status** (processing / shipped / delivered / ready / cancelled / refunded),
pre-order and "mixed values" badges, with expandable per-order details.

**Supported retailers (dedicated parsers):** Kmart, Target, EB Games, Mr Toys
Toyworld, Pokémon Center (Global-e). Plus a generic **Shopify** parser that
covers most small local game stores (LGS) and independent TCG shops, and a
best-effort fallback for anything else. Adding a new retailer is one small
module — see `server/parsers/`.

![Grouped by SKU view](docs/screenshot.png)

## Why

Orders for the same product arrive across many emails, retailers, and buying
accounts. Reading them one by one is painful. This tool parses the emails,
collapses them into one row per product, and lets you see — at a glance — how
many units you have on order and across how many orders.

## Quick start

First install [Node.js](https://nodejs.org) (LTS, v18+). That's the only
prerequisite — the app itself has no dependencies to install.

**Easiest (no terminal):** double-click **`start.command`** (macOS/Linux) or
**`start.bat`** (Windows). It launches the server and opens your browser. On
macOS the first time, right-click → **Open** to get past the security prompt.

**Terminal:**

```bash
npm start          # serves http://localhost:3000
```

The repo ships with a seeded `data/db.json` (built from real parsed order
emails) so you'll see the grouped view immediately.

## How it works

```
email (HTML)  ─▶  parser (per retailer)  ─▶  order { items[] }  ─▶  db.json
                                                     │
                                          SKU normalization
                                                     │
                                            group by SKU  ─▶  /api/groups  ─▶  UI
```

- **`server/parsers/`** — one module per retailer (`kmart.js`, `mrtoys.js`).
  Each exports `matches(email)` and `parse(email)`. Add a retailer by dropping
  in a new module and registering it in `parsers/index.js`.
- **`server/sku.js`** — turns a product name into a canonical slug so the same
  product groups across retailers (e.g. "Trading Card Game" → "tcg", strips set
  codes like "ME2.5"). Supports manual aliases.
- **`server/grouping.js`** — aggregates line items by SKU: total qty, subtotal,
  order total, mixed-values + pre-order flags, distinct order/account counts.
- **`server/index.js`** — zero-dependency HTTP server (REST API + static UI).
- **`public/`** — the dark, Moka-style frontend (vanilla JS, no build step).

## Getting your orders in

### Option A — drop in email exports (works today)

Put email files in `data/emails/` then re-ingest:

```bash
npm run ingest         # or click "Sync" in the UI
```

Supported file types:

- `*.json` — a Gmail thread/message export, an array of email objects, or a
  single email object. Each message needs:
  `{ id, sender, subject, date, htmlBody, toRecipients }`.
- `*.html` — raw email HTML. Name it with a retailer hint so it routes to the
  right parser, e.g. `kmart__632783560.html`, `mrtoys__W00415265.html`.

**Forwarded emails work too.** If you forward an order email (to yourself or a
dedicated inbox the app syncs), the parser detects the quoted "Forwarded
message" header and recovers the original retailer, subject, and recipient — so
forwarding is a valid way to feed in one-off orders.

### Option B — live Gmail sync (pull orders automatically)

The app can connect to your Gmail (read-only) and pull order emails by itself.
One-time Google setup:

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) → create
   a project.
2. **APIs & Services → Enable APIs** → enable the **Gmail API**.
3. **OAuth consent screen** → External → add your own Google account under
   **Test users**.
4. **Credentials → Create credentials → OAuth client ID** → Application type
   **Desktop app** → download the JSON.
5. Save that file as **`data/gmail-credentials.json`** (git-ignored).
6. Install the client library once: `npm install googleapis`
7. Start the app, click **Connect Gmail**, approve access. After that, click
   **Sync Gmail** any time to pull new orders.

Only the read-only Gmail scope is requested. The OAuth token is stored locally
in `data/gmail-token.json` (git-ignored) and never leaves your machine. The set
of senders/subjects searched is in `GMAIL_QUERY` in `server/gmail.js`.

## Order status

Each order carries a lifecycle status parsed from its emails — `processing`
(placed / being prepared), `ready` (for pickup), `shipped`, `delivered`,
`delayed`, `cancelled`, `refunded`. As more emails arrive for the same order
(e.g. a later "shipped" or "cancelled" notice), ingestion **merges** them: the
higher lifecycle stage wins and the original line items are preserved, so a
status-only email never wipes your product data.

Each group row shows a compact status summary (e.g. "3 Shipped · 2 Processing"),
the expanded view shows a status pill per order, and the **status dropdown**
filters the whole list to one status (e.g. show everything still processing).

## Product images

Order emails don't contain real product images, so each SKU starts with an
initials placeholder. Click a thumbnail (or "Set product image" in the expanded
row) to upload an image — it's saved under `public/images/skus/<sku>.<ext>` and
remembered in `db.json`.

## API

| Method | Path                          | Purpose                                    |
| ------ | ----------------------------- | ------------------------------------------ |
| GET    | `/api/groups?sort=&dir=&q=`   | grouped-by-SKU list + totals               |
| GET    | `/api/orders`                 | all parsed orders                          |
| GET    | `/api/retailers`              | supported retailers                        |
| POST   | `/api/ingest`                 | re-ingest `data/emails/`                   |
| GET    | `/api/gmail/status`           | `{ hasCredentials, connected }`            |
| GET    | `/api/gmail/connect`          | start Gmail OAuth (redirects to Google)    |
| POST   | `/api/gmail/sync`             | fetch new orders from Gmail + ingest       |
| POST   | `/api/skus/:sku/image`        | set SKU image (`{ dataUrl }`)              |
| POST   | `/api/skus/:sku/meta`         | set `{ displayName?, notes? }`             |

`sort` ∈ `orders` (default) · `qty` · `value` · `name`.

## Tests

```bash
npm test     # node --test
```

## Project layout

```
server/
  index.js            HTTP server (API + static)
  db.js               JSON file store
  sku.js              product name → canonical SKU
  grouping.js         group orders by SKU
  ingest.js           parse + upsert emails (CLI: npm run ingest)
  gmail.js            optional live Gmail sync seam
  parsers/
    index.js          parser registry + SKU attachment
    kmart.js          Kmart Australia
    target.js         Target Australia
    ebgames.js        EB Games Australia
    mrtoys.js         Mr Toys Toyworld
    pokemoncenter.js  Pokémon Center (Global-e)
    shopify.js        generic Shopify stores (covers most LGS)
    generic.js        best-effort fallback (registered last)
    generic-extract.js shared "Name × N $price" extractor
    util.js           HTML→text, money/date helpers
public/               dark Moka-style frontend
data/
  db.json             the store (seeded)
  emails/             drop email exports here
test/                 node:test suite
```
