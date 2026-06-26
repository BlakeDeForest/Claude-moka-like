// Shared best-effort line-item extraction for order emails whose exact layout
// we don't have a dedicated parser for (Shopify stores, small LGS, etc.).
//
// It looks for the common "Name × N ... $price" shape that nearly every
// e-commerce confirmation uses, in a few orderings.

import { parseMoney } from './util.js';

const SUMMARY = /^(sub\s*total|total|shipping|delivery|tax|gst|discount|order|payment|balance|amount|free)/i;

function pushItem(items, name, qty, price) {
  name = String(name || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length < 2 || SUMMARY.test(name)) return;
  qty = Number(qty) || 1;
  items.push({
    name,
    retailerItemNo: null,
    qty,
    unitPrice: price != null && qty ? round2(price / qty) : price ?? null,
    lineTotal: price ?? null,
    preorder: false,
    releaseDate: null,
  });
}

function nearbyPrice(lines, i) {
  for (let j = i; j <= i + 3 && j < lines.length; j++) {
    const p = lines[j].match(/(?:AU)?\$\s*([\d.,]+)/i);
    if (p) return parseMoney(p[1]);
  }
  return null;
}

/**
 * Extract best-effort items from block-flattened lines.
 * Recognizes: "Name × 2  $50", "Name × 2" + "$50", and "2 × Name" + "$50".
 */
export function genericItems(lines) {
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();

    // "Name × 2" (optionally with price on the same line)
    let m = l.match(/^(.{2,120}?)\s*[×]\s*(\d+)\b/);
    if (m) {
      const inline = l.match(/(?:AU)?\$\s*([\d.,]+)/i);
      pushItem(items, m[1], m[2], inline ? parseMoney(inline[1]) : nearbyPrice(lines, i + 1));
      continue;
    }

    // "2 × Name"
    m = l.match(/^(\d+)\s*[×]\s*(.{2,120})$/);
    if (m) {
      pushItem(items, m[2], m[1], nearbyPrice(lines, i + 1));
      continue;
    }

    // "Name x 2" using the ASCII letter, only when a price is nearby (reduces
    // false positives from product names that legitimately contain " x ").
    m = l.match(/^(.{2,120}?)\s+x\s*(\d+)\b/i);
    if (m && nearbyPrice(lines, i) != null) {
      const inline = l.match(/(?:AU)?\$\s*([\d.,]+)/i);
      pushItem(items, m[1], m[2], inline ? parseMoney(inline[1]) : nearbyPrice(lines, i + 1));
    }
  }
  return items;
}

function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}
