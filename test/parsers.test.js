// Run with: npm test  (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { toSku, slugify } from '../server/sku.js';
import { parseEmail } from '../server/parsers/index.js';
import { groupBySku } from '../server/grouping.js';
import { ingestEmails } from '../server/ingest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMAILS_DIR = path.join(__dirname, '..', 'data', 'emails');

function loadFixtures() {
  if (!fs.existsSync(EMAILS_DIR)) return [];
  return fs
    .readdirSync(EMAILS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(EMAILS_DIR, f), 'utf8')));
}

test('slugify normalizes punctuation and case', () => {
  assert.equal(slugify('One Piece - TCG [OP-16] Booster'), 'one-piece-tcg-op-16-booster');
});

test('toSku collapses "Trading Card Game" and strips set codes', () => {
  assert.equal(
    toSku('Pokemon Trading Card Game ME2.5 Ascended Heroes Booster Bundle'),
    'pokemon-tcg-ascended-heroes-booster-bundle'
  );
});

test('toSku applies manual aliases', () => {
  const aliases = [{ match: 'time of battle', sku: 'one-piece-tcg-op-16-booster' }];
  assert.equal(
    toSku('One Piece Trading Card Game The Time of Battle Boo', aliases),
    'one-piece-tcg-op-16-booster'
  );
});

test('Kmart fixture parses into an order with line items', () => {
  const fixtures = loadFixtures();
  const kmart = fixtures.find((e) => /kmart/i.test(e.sender || ''));
  if (!kmart) return; // fixtures optional in clean checkouts
  const order = parseEmail(kmart);
  assert.equal(order.retailer, 'Kmart');
  assert.ok(order.orderNumber);
  assert.ok(order.items.length >= 1);
  assert.ok(order.items[0].qty > 0);
  assert.ok(order.items[0].sku);
});

test('Mr Toys fixture excludes shipping/summary rows from items', () => {
  const fixtures = loadFixtures();
  const mrtoys = fixtures.find((e) => /mrtoys/i.test(e.sender || ''));
  if (!mrtoys) return;
  const order = parseEmail(mrtoys);
  assert.equal(order.retailer, 'Mr Toys Toyworld');
  for (const it of order.items) {
    assert.ok(!/post|courier|total|gst/i.test(it.name), `unexpected item: ${it.name}`);
  }
  assert.ok(order.total > 0);
});

test('groupBySku aggregates qty and dedupes orders', () => {
  const fixtures = loadFixtures();
  if (!fixtures.length) return;
  const db = { orders: {}, skuMeta: {}, aliases: [] };
  ingestEmails(db, fixtures);
  const { groups, totals } = groupBySku(db, { sort: 'orders' });
  assert.ok(groups.length >= 1);
  // Total units equals the sum across every line item.
  const expectedUnits = Object.values(db.orders)
    .flatMap((o) => o.items)
    .reduce((s, it) => s + it.qty, 0);
  assert.equal(totals.units, expectedUnits);
  // Sorted by order count descending by default.
  for (let i = 1; i < groups.length; i++) {
    assert.ok(groups[i - 1].orderCount >= groups[i].orderCount);
  }
});
