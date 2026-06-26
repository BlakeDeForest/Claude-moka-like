// Parser for EB Games Australia order emails.
// Sender: donotreply@ebgames.com.au
//
// Block-flattened layout (items sit between "Delivery Details" and the
// "Order Number"/"View Order" lines; anything after "Have you seen" is a
// marketing recommendation, NOT part of the order):
//   Delivery Details
//   Standard Delivery (Aus Post)
//   29 Jan 2027
//   x 24
//   One Piece - TCG - [EB-06] Booster
//   View Order
//   Order Number: #10B9BF264AA00E57-A
//
// Preorders show a future release date and no prices (balance charged later).

import { htmlToText, parseMoney, parseDate } from './util.js';

export const retailer = 'EB Games';

export function matches(email) {
  return /ebgames\.com\.au/i.test(email.sender || '');
}

function statusFromSubject(subject = '') {
  // Use the subject only — the preorder body boilerplate mentions "shipped".
  const s = subject.toLowerCase();
  if (s.includes('refund')) return 'refunded';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('shipped') || s.includes('on its way') || s.includes('dispatch')) return 'shipped';
  if (s.includes('ready') && s.includes('collect')) return 'ready';
  return 'confirmed';
}

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function parseLongDate(str) {
  // "29 Jan 2027" -> 2027-01-29
  const m = String(str || '').match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${mo}-${m[1].padStart(2, '0')}`;
}

export function parse(email) {
  const flat = htmlToText(email.htmlBody || '');
  const orderNumber = (flat.match(/Order Number:\s*#?([A-Z0-9-]+)/i) || [])[1];
  if (!orderNumber) return null;

  const lines = htmlToText(email.htmlBody || '', { block: true }).split('\n');

  // Bound the item region: after "Delivery Details", before the order-number /
  // "View Order" / "Have you seen" recommendations block.
  const start = lines.findIndex((l) => /^Delivery Details/i.test(l.trim()));
  let end = lines.findIndex(
    (l, i) => i > start && /^(View Order|Order Number:|Have you seen)/i.test(l.trim())
  );
  if (start < 0) return null;
  if (end < 0) end = lines.length;
  const region = lines.slice(start + 1, end);

  // Release/delivery date inside the region (e.g. "29 Jan 2027").
  let releaseDate = null;
  for (const l of region) {
    const d = parseLongDate(l);
    if (d) {
      releaseDate = d;
      break;
    }
  }
  const isPreorder = /preorder|pre-order|balance of your preorder/i.test(flat);

  const items = [];
  for (let i = 0; i < region.length; i++) {
    const qm = region[i].trim().match(/^x\s*(\d+)$/i);
    if (!qm) continue;
    // Name = next content line that isn't a label/date/price.
    let name = '';
    let lineTotal = null;
    for (let j = i + 1; j < region.length; j++) {
      const cand = region[j].trim();
      if (!cand) continue;
      if (/^(How|When|Standard Delivery|Express|Click)/i.test(cand)) continue;
      if (parseLongDate(cand)) continue;
      const money = cand.match(/^\$([\d.,]+)$/);
      if (money) {
        lineTotal = parseMoney(money[1]);
        continue;
      }
      name = cand;
      break;
    }
    if (!name) continue;
    const qty = Number(qm[1]);
    items.push({
      name,
      retailerItemNo: null,
      qty,
      unitPrice: lineTotal != null && qty ? round2(lineTotal / qty) : null,
      lineTotal,
      preorder: isPreorder,
      releaseDate,
    });
  }
  // Status-only emails may have no line items; still return so status updates.

  const total = parseMoney((flat.match(/(?:Order Total|Total)\s*\$([\d.,]+)/i) || [])[1]);
  const subtotal = items.reduce((s, it) => s + (it.lineTotal || 0), 0) || null;

  return {
    retailer,
    orderNumber: String(orderNumber),
    orderDate: parseDate(email.date),
    account: email.toRecipients && email.toRecipients[0] ? email.toRecipients[0] : null,
    status: statusFromSubject(email.subject || ''),
    currency: 'AUD',
    subtotal,
    shipping: null,
    total,
    items,
    source: { messageId: email.id, subject: email.subject || '' },
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
