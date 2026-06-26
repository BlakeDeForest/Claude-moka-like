// Tiny JSON-file data store. No external DB needed for a local app.
//
// Shape of data/db.json:
// {
//   "orders":  { "<order.id>": Order },
//   "skuMeta": { "<sku>": { "image": "/images/skus/<sku>.png", "displayName": "...", "notes": "" } },
//   "aliases": [ { "match": "ascended heroes booster bundle", "sku": "pokemon-tcg-ascended-heroes-booster-bundle" } ]
// }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const DB_PATH = path.join(DATA_DIR, 'db.json');

const EMPTY = { orders: {}, skuMeta: {}, aliases: [] };

export function load() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...EMPTY, ...parsed };
  } catch (err) {
    if (err.code === 'ENOENT') return structuredClone(EMPTY);
    throw err;
  }
}

export function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  return db;
}

/** Insert or replace an order by its id. Returns true if it was new. */
export function upsertOrder(db, order) {
  const isNew = !db.orders[order.id];
  db.orders[order.id] = order;
  return isNew;
}

export function setSkuMeta(db, sku, patch) {
  db.skuMeta[sku] = { ...(db.skuMeta[sku] || {}), ...patch };
  return db.skuMeta[sku];
}
