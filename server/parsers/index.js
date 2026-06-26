// Parser registry. To support a new retailer, create a module exporting
// { retailer, matches(email), parse(email) } and add it here.

import * as kmart from './kmart.js';
import * as mrtoys from './mrtoys.js';
import * as target from './target.js';
import * as ebgames from './ebgames.js';
import * as pokemoncenter from './pokemoncenter.js';
import * as shopify from './shopify.js';
import * as generic from './generic.js';
import { toSku, displayName } from '../sku.js';
import { parseDate } from './util.js';

// Order matters: specific retailers first, then the Shopify catch-all (covers
// most small LGS), then the best-effort generic fallback LAST.
const PARSERS = [kmart, mrtoys, target, ebgames, pokemoncenter, shopify, generic];

/** Pick the parser whose `matches()` accepts this email, or null. */
export function parserFor(email) {
  return PARSERS.find((p) => p.matches(email)) || null;
}

export function listRetailers() {
  return PARSERS.map((p) => p.retailer);
}

/**
 * Parse a raw email into a normalized order, attaching canonical SKUs to each
 * line item. Returns null if no parser matches or no order number is found.
 *
 * @param {object} email { id, sender, subject, date, htmlBody, plaintextBody, toRecipients }
 * @param {Array} aliases optional SKU aliases [{match, sku}]
 */
export function parseEmail(email, aliases = []) {
  const parser = parserFor(email);
  if (!parser) return null;
  const order = parser.parse(email);
  if (!order || !order.orderNumber) return null;

  order.id = `${slug(order.retailer)}-${order.orderNumber}`;
  // When this status update happened (used to pick the latest status across the
  // order's lifecycle of emails). Falls back to the order date.
  order.statusDate = parseDate(email.date) || order.orderDate || null;
  order.items = (order.items || []).map((it) => ({
    ...it,
    name: displayName(it.name),
    sku: toSku(it.name, aliases),
  }));
  return order;
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
