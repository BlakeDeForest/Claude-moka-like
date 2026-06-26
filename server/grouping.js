// Group order line items by canonical SKU to build the Moka-style list.

import { displayName as cleanName } from './sku.js';

/**
 * @param {object} db the loaded data store
 * @param {object} [opts] { sort: 'orders'|'qty'|'name'|'value', dir: 'asc'|'desc', q: string }
 * @returns {{ groups: Array, totals: object }}
 */
export function groupBySku(db, opts = {}) {
  const { sort = 'orders', dir = 'desc', q = '' } = opts;
  const skuMeta = db.skuMeta || {};
  const groups = new Map();

  for (const order of Object.values(db.orders || {})) {
    for (const item of order.items || []) {
      if (!item.sku) continue;
      let g = groups.get(item.sku);
      if (!g) {
        g = {
          sku: item.sku,
          displayName: null,
          image: null,
          nameCounts: new Map(),
          orderIds: new Set(),
          retailers: new Set(),
          accounts: new Set(),
          statuses: {},
          unitPrices: new Set(),
          totalQty: 0,
          subtotal: 0,
          orderTotalById: new Map(), // dedupe parent order totals
          preorder: false,
          orders: [],
        };
        groups.set(item.sku, g);
      }

      g.nameCounts.set(item.name, (g.nameCounts.get(item.name) || 0) + 1);
      g.orderIds.add(order.id);
      g.retailers.add(order.retailer);
      if (order.account) g.accounts.add(order.account);
      g.statuses[order.status] = (g.statuses[order.status] || 0) + 1;
      if (item.unitPrice != null) g.unitPrices.add(round2(item.unitPrice));
      g.totalQty += item.qty || 0;
      g.subtotal += item.lineTotal || 0;
      if (!g.orderTotalById.has(order.id)) {
        g.orderTotalById.set(order.id, order.total || 0);
      }
      if (item.preorder) g.preorder = true;

      g.orders.push({
        orderId: order.id,
        retailer: order.retailer,
        account: order.account,
        orderNumber: order.orderNumber,
        orderDate: order.orderDate,
        status: order.status,
        qty: item.qty,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        preorder: item.preorder,
        releaseDate: item.releaseDate,
        orderTotal: order.total,
      });
    }
  }

  let list = [...groups.values()].map((g) => {
    const meta = skuMeta[g.sku] || {};
    const orderTotal = [...g.orderTotalById.values()].reduce((a, b) => a + b, 0);
    return {
      sku: g.sku,
      displayName: meta.displayName || mostCommon(g.nameCounts) || g.sku,
      image: meta.image || null,
      notes: meta.notes || '',
      orderCount: g.orderIds.size,
      totalQty: g.totalQty,
      subtotal: round2(g.subtotal),
      orderTotal: round2(orderTotal),
      mixedValues: g.unitPrices.size > 1,
      preorder: g.preorder,
      retailers: [...g.retailers].sort(),
      accounts: [...g.accounts].sort(),
      statuses: g.statuses,
      orders: g.orders.sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || '')),
    };
  });

  if (q) {
    const needle = q.toLowerCase();
    list = list.filter(
      (g) =>
        g.displayName.toLowerCase().includes(needle) ||
        g.sku.includes(needle) ||
        g.retailers.some((r) => r.toLowerCase().includes(needle))
    );
  }

  list.sort(comparator(sort, dir));

  const totals = {
    skus: list.length,
    orders: new Set(
      list.flatMap((g) => g.orders.map((o) => o.orderId))
    ).size,
    units: list.reduce((s, g) => s + g.totalQty, 0),
    value: round2(list.reduce((s, g) => s + g.subtotal, 0)),
  };

  return { groups: list, totals };
}

function comparator(sort, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  const keyFns = {
    orders: (g) => g.orderCount,
    qty: (g) => g.totalQty,
    value: (g) => g.subtotal,
    name: (g) => g.displayName.toLowerCase(),
  };
  const keyFn = keyFns[sort] || keyFns.orders;
  return (a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    if (ka < kb) return -1 * sign;
    if (ka > kb) return 1 * sign;
    // Stable secondary sort: order count desc, then name.
    if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
    return a.displayName.localeCompare(b.displayName);
  };
}

function mostCommon(counts) {
  let best = null;
  let bestN = -1;
  for (const [name, n] of counts) {
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  }
  return best;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
