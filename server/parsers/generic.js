// Last-resort best-effort parser for any order email from a sender we don't
// have a dedicated parser for. Registered LAST so specific parsers always win.
//
// To avoid polluting the tracker with junk, it only produces an order when it
// can find BOTH an order number and at least one priced line item.

import { htmlToText, parseMoney, parseDate } from './util.js';
import { genericItems } from './generic-extract.js';

export const retailer = 'Other';

// Matches anything — but parse() is conservative and often returns null.
export function matches() {
  return true;
}

function senderLabel(email) {
  const from = email.sender || '';
  const display = (from.match(/^"?([^"<]+?)"?\s*</) || [])[1];
  if (display && !/no-?reply|do-?not-?reply|orders?|sales|info|mail|notification/i.test(display)) {
    return display.trim();
  }
  const domain = (from.match(/@([^>]+)/) || [])[1] || '';
  const host = domain.split('.').slice(0, -1).join('.') || domain;
  return host ? `${host[0].toUpperCase()}${host.slice(1)}` : retailer;
}

function looksLikeOrder(subject = '', flat = '') {
  return /order|purchase|receipt|invoice/i.test(subject) || /order\s*(?:number|no|#)/i.test(flat);
}

export function parse(email) {
  const flat = htmlToText(email.htmlBody || '');
  const subject = email.subject || '';
  if (!looksLikeOrder(subject, flat)) return null;

  const orderNumber =
    (subject.match(/#\s*(\w[\w-]{2,})/) || [])[1] ||
    (flat.match(/Order\s*(?:Number|No\.?|#)\s*[:#]?\s*(\w[\w-]{2,})/i) || [])[1];
  if (!orderNumber) return null;

  const lines = htmlToText(email.htmlBody || '', { block: true }).split('\n');
  const items = genericItems(lines).filter((it) => it.lineTotal != null);
  if (!items.length) return null;

  const total = parseMoney((flat.match(/(?<![A-Za-z])(?:Order\s*)?Total\s*(?:AU)?\$([\d.,]+)/i) || [])[1]);
  const shipping = parseMoney((flat.match(/Shipping\s*(?:AU)?\$([\d.,]+)/i) || [])[1]);
  const subtotal = items.reduce((s, it) => s + (it.lineTotal || 0), 0) || null;

  return {
    retailer: senderLabel(email),
    orderNumber: String(orderNumber),
    orderDate: parseDate(email.date),
    account: email.toRecipients && email.toRecipients[0] ? email.toRecipients[0] : null,
    status: 'confirmed',
    currency: 'AUD',
    subtotal,
    shipping,
    total,
    items,
    source: { messageId: email.id, subject, via: 'generic' },
  };
}
