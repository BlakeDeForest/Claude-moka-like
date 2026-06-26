// Parser for Mr Toys Toyworld order emails.
// Sender: sales@mrtoys.com.au / offers@mrtoys.com.au
//
// Block-flattened item region looks like:
//   Qty
//   Pokemon Trading Card Game ME2.5 Ascended Heroes Booster Bundle
//   $54.00     <- unit price
//   $108.00    <- line total
//   $12.90     <- shipping
//   $120.90    <- order total
//   Order Date: 22/06/2026
//
// Strategy: between the "Qty" header and "Order Date", collect product-name
// lines and money lines. The last two money values are [shipping, total];
// the rest pair up as [unit, lineTotal] per product, in order.

import { htmlToText, parseMoney, parseDate } from './util.js';

export const retailer = 'Mr Toys Toyworld';

export function matches(email) {
  return /mrtoys\.com\.au/i.test(email.sender || '');
}

function statusFromSubject(subject = '') {
  const s = subject.toLowerCase();
  if (s.includes('refund')) return 'refunded';
  if (s.includes('shipping') || s.includes('shipped') || s.includes('despatch')) return 'shipped';
  if (s.includes('received') || s.includes('confirmation')) return 'confirmed';
  return 'unknown';
}

export function parse(email) {
  const flat = htmlToText(email.htmlBody || '');
  const orderNumber =
    (flat.match(/ORDER NUMBER IS\s*([A-Z0-9]+)/i) || [])[1] ||
    (flat.match(/Order\s*(?:Number|No\.?)\s*[:#]?\s*([A-Z0-9]{5,})/i) || [])[1] ||
    null;
  if (!orderNumber) return null;

  const orderDate =
    parseDate((flat.match(/Order Date:\s*([\d/]+)/i) || [])[1]) || parseDate(email.date);

  const lines = htmlToText(email.htmlBody || '', { block: true }).split('\n');

  // Bound the item region.
  const startIdx = lines.findIndex((l) => /^Qty$/i.test(l.trim()));
  const endIdx = lines.findIndex((l) => /^Order Date:/i.test(l.trim()));
  const region = lines.slice(
    startIdx >= 0 ? startIdx + 1 : 0,
    endIdx >= 0 ? endIdx : lines.length
  );

  // Group the region into rows: each named line followed by its money values,
  // e.g. { name: "Pokemon ...", monies: [54, 108] }.
  const rows = [];
  const allMoney = [];
  for (const raw of region) {
    const l = raw.trim();
    if (!l) continue;
    if (/^\$[\d,.]+$/.test(l)) {
      const val = parseMoney(l);
      allMoney.push(val);
      if (rows.length) rows[rows.length - 1].monies.push(val);
    } else if (/[a-z]/i.test(l)) {
      rows.push({ name: l, monies: [] });
    }
  }

  const isShipping = (name) => /post|courier|freight|despatch|delivery charge|shipping/i.test(name);
  const isSummary = (name) =>
    /^(sub\s*total|total amount|grand total|order total|total\b|amount|gst|tax|payment|qty)/i.test(name);

  let shipping = null;
  let subtotal = null;
  let total = null;
  const items = [];
  for (const row of rows) {
    const firstMoney = row.monies.length ? row.monies[0] : null;
    if (isShipping(row.name)) {
      if (shipping == null) shipping = firstMoney;
      continue;
    }
    if (isSummary(row.name)) {
      if (/sub\s*total/i.test(row.name) && firstMoney != null) subtotal = firstMoney;
      else if (/(total amount|grand total|order total|^total)/i.test(row.name) && firstMoney != null) {
        total = firstMoney;
      }
      continue;
    }
    const unitPrice = row.monies[0] ?? null;
    const lineTotal = row.monies[1] ?? unitPrice;
    const qty = unitPrice && lineTotal ? Math.max(1, Math.round(lineTotal / unitPrice)) : 1;
    items.push({
      name: row.name,
      retailerItemNo: null,
      qty,
      unitPrice,
      lineTotal: lineTotal ?? (unitPrice != null ? unitPrice * qty : null),
      preorder: false,
      releaseDate: null,
    });
  }

  if (total == null && allMoney.length) total = allMoney[allMoney.length - 1];
  if (subtotal == null) subtotal = items.reduce((s, it) => s + (it.lineTotal || 0), 0) || null;

  return {
    retailer,
    orderNumber: String(orderNumber),
    orderDate,
    account: email.toRecipients && email.toRecipients[0] ? email.toRecipients[0] : null,
    status: statusFromSubject(email.subject || ''),
    currency: 'AUD',
    subtotal,
    shipping,
    total,
    items,
    source: { messageId: email.id, subject: email.subject || '' },
  };
}
