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
import { parseDate, htmlToText } from './util.js';

/**
 * If an email is a forward (e.g. you forward order emails to yourself/the app),
 * the From header is the forwarder, not the retailer. Recover the original
 * sender / subject / recipient from the quoted "Forwarded message" header so
 * the right parser is selected.
 */
export function unwrapForwarded(email) {
  const subject = email.subject || '';
  const text = email.plaintextBody || htmlToText(email.htmlBody || '');
  const isForward =
    /-{2,}\s*Forwarded message\s*-{2,}/i.test(text) || /^\s*(fwd?|fw):/i.test(subject);
  if (!isForward) return email;

  // Look at the first ~1500 chars where the quoted header sits.
  const head = text.slice(0, 1500);
  const origFrom = (head.match(/From:\s*"?[^"<\n]*"?\s*<?\s*([^\s>@]+@[^\s>]+)/i) || [])[1];
  const origSubject = (head.match(/Subject:\s*(.+)/i) || [])[1];
  const origTo = (head.match(/To:\s*"?[^"<\n]*"?\s*<?\s*([^\s>@]+@[^\s>]+)/i) || [])[1];
  const origDate = (head.match(/Date:\s*(.+)/i) || [])[1];

  return {
    ...email,
    sender: origFrom || email.sender,
    subject: (origSubject || subject).replace(/^\s*(fwd?|fw):\s*/i, '').trim(),
    toRecipients: origTo ? [origTo] : email.toRecipients,
    date: forwardDateToISO(origDate) || email.date,
    _forwarded: true,
  };
}

function forwardDateToISO(str) {
  if (!str) return null;
  // e.g. "Fri, Jun 12, 2026 at 2:41 PM" -> grab the "Jun 12, 2026" portion.
  const m = str.match(/([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

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
export function parseEmail(rawEmail, aliases = []) {
  const email = unwrapForwarded(rawEmail);
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
