// Parser for Pokémon Center (AU) order emails, fulfilled by Global-e.
// Sender: do-not-reply@global-e.com  (subject mentions "Pokémon Center")
//
// Block-flattened layout:
//   Order Number: GE12592690351US
//   Order Placed: 16/06/2026
//   Shipment Items
//   Pokémon TCG: Sword & Shield-Astral Radiance Booster Display Box (36 Packs)
//   AU$256.99
//   Qty: 1
//   Shipping Method ...
//   Subtotal AU$256.99
//   Shipping AU$32.92
//   Total AU$289.91

import { htmlToText, parseMoney, parseDate } from './util.js';

export const retailer = 'Pokémon Center';

export function matches(email) {
  const from = email.sender || '';
  const subj = email.subject || '';
  return /global-e\.com/i.test(from) && /pok[eé]mon center/i.test(subj);
}

function statusFromSubject(subject = '') {
  const s = subject.toLowerCase();
  if (s.includes('refund')) return 'refunded';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('shipped') || s.includes('dispatch') || s.includes('on its way')) return 'shipped';
  return 'confirmed';
}

export function parse(email) {
  const flat = htmlToText(email.htmlBody || '');
  const orderNumber = (flat.match(/Order Number:\s*([A-Z0-9]+)/i) || [])[1];
  if (!orderNumber) return null;

  const orderDate =
    parseDate((flat.match(/Order Placed:\s*([\d/]+)/i) || [])[1]) || parseDate(email.date);

  const lines = htmlToText(email.htmlBody || '', { block: true }).split('\n');
  const start = lines.findIndex((l) => /^Shipment Items/i.test(l.trim()));
  const end = lines.findIndex(
    (l, i) => i > start && /^(Shipping Method|Payment Details|Subtotal)/i.test(l.trim())
  );
  const region = lines.slice(start >= 0 ? start + 1 : 0, end >= 0 ? end : lines.length);

  const items = [];
  for (let i = 0; i < region.length; i++) {
    const qm = region[i].trim().match(/Qty:\s*(\d+)/i);
    if (!qm) continue;
    const qty = Number(qm[1]);
    let name = '';
    let price = null;
    for (let j = i - 1; j >= 0; j--) {
      const cand = region[j].trim();
      if (!cand) continue;
      const money = cand.match(/AU?\$\s*([\d.,]+)/i);
      if (money) {
        if (price == null) price = parseMoney(money[1]);
        continue;
      }
      if (/not eligible|eligible for return|in stock|free/i.test(cand)) continue;
      name = cand;
      break;
    }
    if (!name) continue;
    items.push({
      name,
      retailerItemNo: null,
      qty,
      unitPrice: price,
      lineTotal: price != null ? round2(price * qty) : null,
      preorder: /pre-?order/i.test(flat),
      releaseDate: null,
    });
  }
  if (!items.length) return null;

  const subtotal = parseMoney((flat.match(/Subtotal\s*AU?\$([\d.,]+)/i) || [])[1]);
  const shipping = parseMoney((flat.match(/Shipping\s*AU?\$([\d.,]+)/i) || [])[1]);
  const total = parseMoney((flat.match(/(?<![A-Za-z])Total\s*AU?\$([\d.,]+)/i) || [])[1]);

  return {
    retailer,
    orderNumber: String(orderNumber),
    orderDate,
    account: email.toRecipients && email.toRecipients[0] ? email.toRecipients[0] : null,
    status: statusFromSubject(email.subject || ''),
    currency: 'AUD',
    subtotal: subtotal ?? (items.reduce((s, it) => s + (it.lineTotal || 0), 0) || null),
    shipping,
    total,
    items,
    source: { messageId: email.id, subject: email.subject || '' },
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
