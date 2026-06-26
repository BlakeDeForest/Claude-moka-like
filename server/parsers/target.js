// Parser for Target Australia order emails.
// Sender: donotreply@targetnewsletter.com.au
//
// The plaintext body is clean and reliable, e.g.:
//   Your Order#: 563882041Order Placed: 08/05/2026Receipt#: ...
//   Pokemon TCG: Triple Whammy Tins - Assorted Item Code: 72979785Unit Price: $30.00
//   Qty: 1
//   $30.00
//   Delivery Fee:$9.00
//   Order Total
//   $30.00

import { htmlToText, parseMoney, parseDate } from './util.js';

export const retailer = 'Target';

export function matches(email) {
  return /target(newsletter)?\.com\.au/i.test(email.sender || '');
}

function statusFromSubject(subject = '') {
  const s = subject.toLowerCase();
  if (s.includes('refund')) return 'refunded';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('shipped') || s.includes('on its way') || s.includes('dispatch')) return 'shipped';
  if (s.includes('confirmed') || s.includes('thanks for your order')) return 'confirmed';
  return 'unknown';
}

function clean(text) {
  return String(text || '')
    .replace(/&zwnj;|‌/g, '')
    .replace(/&amp;/g, '&');
}

export function parse(email) {
  const text = clean(email.plaintextBody || htmlToText(email.htmlBody || '', { block: true }));

  const orderNumber = (text.match(/Your Order#:\s*(\d+)/i) || [])[1];
  if (!orderNumber) return null;

  const orderDate =
    parseDate((text.match(/Order Placed:\s*([\d/]+)/i) || [])[1]) || parseDate(email.date);

  // Each item: "<name> Item Code: <code> Unit Price: $X  Qty: N  $line"
  const itemRe =
    /([^\n]+?)\s*Item Code:\s*[^\d]*(\d+)[^\d]*Unit Price:\s*\$([\d.,]+)\s*Qty:\s*(\d+)\s*\$([\d.,]+)/gi;
  const items = [];
  let m;
  while ((m = itemRe.exec(text)) !== null) {
    const [, name, code, unit, qty, line] = m;
    items.push({
      name: name.trim(),
      retailerItemNo: code,
      qty: Number(qty),
      unitPrice: parseMoney(unit),
      lineTotal: parseMoney(line),
      preorder: false,
      releaseDate: null,
    });
  }
  if (!items.length) return null;

  const total = parseMoney((text.match(/Order Total\s*\$?\s*([\d.,]+)/i) || [])[1]);
  const shipping = parseMoney((text.match(/Delivery Fee:\s*\$([\d.,]+)/i) || [])[1]);
  const subtotal = items.reduce((s, it) => s + (it.lineTotal || 0), 0) || null;

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
