// Parser for Kmart Australia order emails.
// Sender: DonotReply.OnlineShop@orders.kmart.com.au / noreply@orders.kmart.com.au
//
// Line items render in the HTML (not the plaintext) roughly as:
//   <name> #43792245 Quantity : 10 $72.00 Pre-order (15/06/26)
// We walk the block-flattened text so each cell is its own line.

import { htmlToText, parseMoney, parseDate } from './util.js';

const LABELS = new Set([
  'quantity', 'pre-order', 'estimated delivery', 'return in-store at kmart only',
  'sold by kmart', 'delivery address', 'delivery instructions:',
]);

export const retailer = 'Kmart';

export function matches(email) {
  return /kmart\.com\.au/i.test(email.sender || '');
}

function statusFromSubject(subject = '') {
  const s = subject.toLowerCase();
  if (s.includes('refund')) return 'refunded';
  if (s.includes('shipped') || s.includes('on its way')) return 'shipped';
  if (s.includes('update on your order')) return 'delayed';
  if (s.includes('confirmed') || s.includes('being prepared')) return 'confirmed';
  return 'unknown';
}

export function parse(email) {
  const subject = email.subject || '';
  const orderNumber =
    (subject.match(/#?(\d{6,})/) || [])[1] ||
    (htmlToText(email.htmlBody || '').match(/Order number\s*#?(\d{6,})/i) || [])[1] ||
    null;
  if (!orderNumber) return null;

  const flat = htmlToText(email.htmlBody || '');
  const orderDate =
    parseDate((flat.match(/Order date\s*([\d/]+)/i) || [])[1]) || parseDate(email.date);

  const lines = htmlToText(email.htmlBody || '', { block: true }).split('\n');
  const items = [];

  for (let i = 0; i < lines.length; i++) {
    const qm = lines[i].match(/^Quantity\s*:\s*(\d+)/i);
    if (!qm) continue;
    const qty = Number(qm[1]);

    // Name = nearest preceding "content" line; item number may be on the name
    // line or its own line just above the Quantity row.
    let name = '';
    let retailerItemNo = null;
    for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
      const cand = lines[j].trim();
      if (!cand) continue;
      const hashOnly = cand.match(/^#(\d{4,})$/);
      if (hashOnly) {
        retailerItemNo = hashOnly[1];
        continue;
      }
      if (/^\$[\d,.]+$/.test(cand)) continue;
      if (LABELS.has(cand.toLowerCase())) continue;
      // This is the product name (strip any trailing "#number").
      const withHash = cand.match(/^(.*?)\s*#(\d{4,})\s*$/);
      if (withHash) {
        name = withHash[1].trim();
        retailerItemNo = retailerItemNo || withHash[2];
      } else {
        name = cand;
      }
      break;
    }
    if (!name) continue;

    // Price = first money line after the Quantity row.
    let unitOrLine = null;
    let preorder = false;
    let releaseDate = null;
    for (let k = i + 1; k < lines.length && k <= i + 4; k++) {
      if (unitOrLine == null && /^\$[\d,.]+$/.test(lines[k].trim())) {
        unitOrLine = parseMoney(lines[k]);
      }
      const pm = lines[k].match(/Pre-order\s*\(([^)]*)\)/i);
      if (pm) {
        preorder = true;
        releaseDate = parseDate(pm[1]);
      }
    }

    items.push({
      name,
      retailerItemNo,
      qty,
      // Kmart shows the line total (qty x price), not the unit price.
      lineTotal: unitOrLine,
      unitPrice: unitOrLine != null && qty ? round2(unitOrLine / qty) : null,
      preorder,
      releaseDate,
    });
  }

  const subtotal = parseMoney((flat.match(/Subtotal\s*\$([\d,.]+)/i) || [])[1]);
  const total = parseMoney((flat.match(/Order Total[^$]*\$([\d,.]+)/i) || [])[1]);
  const shipping =
    /total delivery\s*free/i.test(flat) ? 0 : null;

  return {
    retailer,
    orderNumber: String(orderNumber),
    orderDate,
    account: email.toRecipients && email.toRecipients[0] ? email.toRecipients[0] : null,
    status: statusFromSubject(subject),
    currency: 'AUD',
    subtotal,
    shipping,
    total,
    items,
    source: { messageId: email.id, subject },
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
