// Generic parser for Shopify-powered stores — covers a large share of small
// local game stores (LGS) and independent TCG shops, which mostly run Shopify.
//
// Shopify order emails are recognizable by cdn.shopify.com assets and an order
// list with "Title × qty" rows. This is best-effort but the Shopify template is
// fairly consistent across stores.

import { htmlToText, parseMoney, parseDate } from './util.js';
import { genericItems } from './generic-extract.js';

export const retailer = 'Shopify store';

export function matches(email) {
  const html = email.htmlBody || '';
  const from = email.sender || '';
  return /cdn\.shopify\.com|myshopify\.com|shopifyemail/i.test(html) || /myshopify\.com/i.test(from);
}

function storeName(email) {
  // Prefer a friendly store name from the sender display or domain.
  const from = email.sender || '';
  const display = (from.match(/^"?([^"<]+?)"?\s*</) || [])[1];
  if (display && !/no-?reply|do-?not-?reply|orders?|sales|info|mail/i.test(display)) {
    return display.trim();
  }
  const domain = (from.match(/@([^>]+)/) || [])[1] || '';
  const host = domain.replace(/\.myshopify\.com$/i, '').split('.')[0];
  return host ? `${host[0].toUpperCase()}${host.slice(1)}` : retailer;
}

function statusFromSubject(subject = '') {
  const s = subject.toLowerCase();
  if (s.includes('refund')) return 'refunded';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('shipped') || s.includes('on its way') || s.includes('fulfil')) return 'shipped';
  return 'confirmed';
}

export function parse(email) {
  const flat = htmlToText(email.htmlBody || '');
  const orderNumber =
    (email.subject && email.subject.match(/#(\w[\w-]*)/) || [])[1] ||
    (flat.match(/Order\s+#(\w[\w-]*)/i) || [])[1];
  if (!orderNumber) return null;

  const lines = htmlToText(email.htmlBody || '', { block: true }).split('\n');
  const items = genericItems(lines);
  if (!items.length) return null;

  const subtotal = parseMoney((flat.match(/Subtotal\s*(?:AU)?\$([\d.,]+)/i) || [])[1]);
  const shipping = parseMoney((flat.match(/Shipping\s*(?:AU)?\$([\d.,]+)/i) || [])[1]);
  const total = parseMoney((flat.match(/(?<![A-Za-z])Total\s*(?:AU)?\$([\d.,]+)/i) || [])[1]);

  return {
    retailer: storeName(email),
    orderNumber: String(orderNumber),
    orderDate: parseDate(email.date),
    account: email.toRecipients && email.toRecipients[0] ? email.toRecipients[0] : null,
    status: statusFromSubject(email.subject || ''),
    currency: 'AUD',
    subtotal: subtotal ?? (items.reduce((s, it) => s + (it.lineTotal || 0), 0) || null),
    shipping,
    total,
    items,
    source: { messageId: email.id, subject: email.subject || '', via: 'shopify' },
  };
}
