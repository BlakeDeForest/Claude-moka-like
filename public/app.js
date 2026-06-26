// Frontend logic: fetch grouped SKUs, render the Moka-style list, handle
// expand/collapse, search, sort, per-SKU image upload, and re-sync.

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const statsEl = document.getElementById('stats');
const searchEl = document.getElementById('search');
const sortEl = document.getElementById('sort');
const statusFilterEl = document.getElementById('statusFilter');
const syncEl = document.getElementById('sync');
const imgInput = document.getElementById('imgInput');
const panelHintEl = document.getElementById('panelHint');
const tabEls = document.querySelectorAll('.tab');

// Sort options per view. Each sets both the sort key and direction.
const SORT_OPTIONS = {
  sku: [
    { label: 'Most orders', sort: 'orders', dir: 'desc' },
    { label: 'Highest qty', sort: 'qty', dir: 'desc' },
    { label: 'Highest value', sort: 'value', dir: 'desc' },
    { label: 'Name (A–Z)', sort: 'name', dir: 'asc' },
  ],
  orders: [
    { label: 'Newest first', sort: 'date', dir: 'desc' },
    { label: 'Oldest first', sort: 'date', dir: 'asc' },
    { label: 'Status', sort: 'status', dir: 'asc' },
    { label: 'Retailer', sort: 'retailer', dir: 'asc' },
    { label: 'Highest value', sort: 'value', dir: 'desc' },
    { label: 'Highest qty', sort: 'qty', dir: 'desc' },
  ],
};

let state = { view: 'sku', sort: 'orders', dir: 'desc', q: '', status: '', open: new Set() };
let pendingImageSku = null;

// Canonical status -> { label, class } for pills and chips.
const STATUS_META = {
  processing: { label: 'Processing', cls: 'processing' },
  confirmed: { label: 'Processing', cls: 'processing' },
  ready: { label: 'Ready for pickup', cls: 'ready' },
  shipped: { label: 'Shipped', cls: 'shipped' },
  delivered: { label: 'Delivered', cls: 'delivered' },
  delayed: { label: 'Delayed', cls: 'delayed' },
  cancelled: { label: 'Cancelled', cls: 'cancelled' },
  refunded: { label: 'Refunded', cls: 'refunded' },
  unknown: { label: 'Unknown', cls: 'unknown' },
};
const statusMeta = (s) => STATUS_META[s] || { label: s || 'Unknown', cls: 'unknown' };

const money = (n) =>
  (n == null ? 0 : n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name) =>
  esc(String(name || '?').replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?');

async function load() {
  const params = new URLSearchParams({ sort: state.sort, dir: state.dir, q: state.q, status: state.status });
  if (state.view === 'sku') {
    const data = await (await fetch(`/api/groups?${params}`)).json();
    renderSku(data);
  } else {
    const data = await (await fetch(`/api/orders?${params}`)).json();
    renderOrders(data);
  }
}

function populateSort() {
  const opts = SORT_OPTIONS[state.view];
  sortEl.innerHTML = opts.map((o, i) => `<option value="${i}">${o.label}</option>`).join('');
  let idx = opts.findIndex((o) => o.sort === state.sort && o.dir === state.dir);
  if (idx < 0) {
    idx = 0;
    state.sort = opts[0].sort;
    state.dir = opts[0].dir;
  }
  sortEl.value = String(idx);
}

function setView(view) {
  if (view === state.view) return;
  state.view = view;
  state.open = new Set();
  const def = SORT_OPTIONS[view][0];
  state.sort = def.sort;
  state.dir = def.dir;
  tabEls.forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  panelHintEl.textContent =
    view === 'sku'
      ? 'Click a row to expand order-level details.'
      : 'Every order, newest first. Click a row to see its items.';
  populateSort();
  load();
}

function renderStatusFilter(statusCounts = {}) {
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const opts = [`<option value="">All statuses (${total})</option>`];
  for (const [s, n] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    opts.push(`<option value="${esc(s)}">${esc(statusMeta(s).label)} (${n})</option>`);
  }
  statusFilterEl.innerHTML = opts.join('');
  statusFilterEl.value = state.status;
}

function renderSku({ groups, totals, statusCounts }) {
  statsEl.innerHTML = `
    <div><span>SKUs</span><b class="num">${totals.skus}</b></div>
    <div><span>Orders</span><b class="num">${totals.orders}</b></div>
    <div><span>Units</span><b class="num">${totals.units}</b></div>
    <div><span>Value</span><b class="num">$${money(totals.value)}</b></div>`;

  renderStatusFilter(statusCounts);
  emptyEl.hidden = groups.length > 0;
  listEl.innerHTML = groups.map(renderGroup).join('');
  wire();
}

function renderOrders({ orders, totals, statusCounts }) {
  statsEl.innerHTML = `
    <div><span>Orders</span><b class="num">${totals.orders}</b></div>
    <div><span>Units</span><b class="num">${totals.units}</b></div>
    <div><span>Value</span><b class="num">$${money(totals.value)}</b></div>`;

  renderStatusFilter(statusCounts);
  emptyEl.hidden = orders.length > 0;
  listEl.innerHTML = orders.map(renderOrderRow).join('');
  wire();
}

function renderOrderRow(o) {
  const open = state.open.has(o.id) ? ' open' : '';
  const badges = o.preorder ? `<span class="badge badge--preorder">Pre-order</span>` : '';
  const m = statusMeta(o.status);
  return `
  <div class="group${open}" data-order="${esc(o.id)}">
    <div class="grow" data-toggle>
      <div class="thumb">${initials(o.retailer)}</div>
      <div class="grow__main">
        <div class="grow__name">${esc(o.retailer)} · #${esc(o.orderNumber)}</div>
        <div class="grow__sub">${esc(o.orderDate || '—')} · ${esc(prettyAccount(o.account))} · ${o.itemCount} item${o.itemCount === 1 ? '' : 's'}<span class="statusline"><span class="pill pill--${m.cls}">${esc(m.label)}</span></span></div>
      </div>
      <div class="grow__metrics">
        <div class="metric"><span>Qty</span><b class="num">${o.totalQty}</b></div>
        <div class="metric"><span>Total</span><b class="num">$${money(o.total)}</b></div>
        ${badges}
        <button class="chev" title="Expand">▾</button>
      </div>
    </div>
    ${open ? renderOrderItems(o) : ''}
  </div>`;
}

function renderOrderItems(o) {
  const rows = o.items
    .map(
      (it) => `
    <tr>
      <td>${esc(it.name)}</td>
      <td>${esc(it.sku)}</td>
      <td class="num">${it.qty}</td>
      <td class="num">${it.unitPrice == null ? '—' : '$' + money(it.unitPrice)}</td>
      <td class="num">${it.lineTotal == null ? '—' : '$' + money(it.lineTotal)}</td>
    </tr>`
    )
    .join('');
  return `
  <div class="detail">
    <table>
      <thead><tr><th>Product</th><th>SKU</th><th>Qty</th><th>Unit</th><th>Line total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// Build compact status chips (e.g. "3 Shipped" "2 Processing") for a group.
function statusChips(statuses = {}) {
  const entries = Object.entries(statuses).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '';
  return (
    '<span class="statusline">' +
    entries
      .map(([s, n]) => {
        const m = statusMeta(s);
        return `<span class="pill pill--${m.cls}">${n} ${esc(m.label)}</span>`;
      })
      .join('') +
    '</span>'
  );
}

function renderGroup(g) {
  const open = state.open.has(g.sku) ? ' open' : '';
  const thumb = g.image
    ? `<img src="${esc(g.image)}" alt="" />`
    : initials(g.displayName);
  const badges = [
    g.mixedValues ? `<span class="badge">Mixed values</span>` : '',
    g.preorder ? `<span class="badge badge--preorder">Pre-order</span>` : '',
  ].join('');

  return `
  <div class="group${open}" data-sku="${esc(g.sku)}">
    <div class="grow" data-toggle>
      <div class="thumb" data-img title="Click to set image">${thumb}</div>
      <div class="grow__main">
        <div class="grow__name">${esc(g.displayName)}</div>
        <div class="grow__sub">SKU: ${esc(g.sku)} · ${g.orderCount} order${g.orderCount === 1 ? '' : 's'} · ${esc(g.retailers.join(', '))}${statusChips(g.statuses)}</div>
      </div>
      <div class="grow__metrics">
        <div class="metric"><span>Qty</span><b class="num">${g.totalQty}</b></div>
        <div class="metric"><span>Subtotal</span><b class="num">$${money(g.subtotal)}</b></div>
        <div class="metric"><span>Order total</span><b class="num">$${money(g.orderTotal)}</b></div>
        ${badges}
        <button class="chev" title="Expand">▾</button>
      </div>
    </div>
    ${open ? renderDetail(g) : ''}
  </div>`;
}

function renderDetail(g) {
  const rows = g.orders
    .map(
      (o) => `
    <tr>
      <td>${esc(o.orderDate || '—')}</td>
      <td>${esc(o.retailer)}</td>
      <td>#${esc(o.orderNumber)}</td>
      <td>${esc(prettyAccount(o.account))}</td>
      <td><span class="pill pill--${statusMeta(o.status).cls}">${esc(statusMeta(o.status).label)}</span>${o.preorder ? ' <span class="pill">pre-order' + (o.releaseDate ? ' ' + esc(o.releaseDate) : '') + '</span>' : ''}</td>
      <td class="num">${o.qty}</td>
      <td class="num">${o.unitPrice == null ? '—' : '$' + money(o.unitPrice)}</td>
      <td class="num">${o.lineTotal == null ? '—' : '$' + money(o.lineTotal)}</td>
    </tr>`
    )
    .join('');

  return `
  <div class="detail">
    <table>
      <thead>
        <tr><th>Date</th><th>Retailer</th><th>Order #</th><th>Account</th><th>Status</th><th>Qty</th><th>Unit</th><th>Line total</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="detail__actions">
      <button data-img>Set product image</button>
    </div>
  </div>`;
}

function prettyAccount(acc) {
  if (!acc) return '—';
  return acc.split('@')[0].replace(/[._]/g, ' ').replace(/\d+/g, '').trim() || acc;
}

function wire() {
  listEl.querySelectorAll('.group').forEach((groupEl) => {
    const key = groupEl.dataset.sku || groupEl.dataset.order;

    groupEl.querySelectorAll('[data-toggle]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-img]')) return; // image click handled separately
        if (state.open.has(key)) state.open.delete(key);
        else state.open.add(key);
        load();
      });
    });

    groupEl.querySelectorAll('[data-img]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingImageSku = groupEl.dataset.sku;
        imgInput.click();
      });
    });
  });
}

imgInput.addEventListener('change', async () => {
  const file = imgInput.files[0];
  if (!file || !pendingImageSku) return;
  const dataUrl = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(file);
  });
  await fetch(`/api/skus/${encodeURIComponent(pendingImageSku)}/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl }),
  });
  imgInput.value = '';
  pendingImageSku = null;
  load();
});

// ---- Gmail connect / sync ----
const gmailEl = document.getElementById('gmail');

async function refreshGmail() {
  try {
    const s = await (await fetch('/api/gmail/status')).json();
    gmailEl.dataset.state = !s.hasCredentials ? 'setup' : s.connected ? 'connected' : 'disconnected';
    gmailEl.textContent = !s.hasCredentials
      ? 'Gmail: set up'
      : s.connected
        ? 'Sync Gmail'
        : 'Connect Gmail';
  } catch {
    gmailEl.textContent = 'Gmail';
  }
}

gmailEl.addEventListener('click', async () => {
  const state = gmailEl.dataset.state;
  if (state === 'setup') {
    alert(
      'One-time setup needed for live Gmail sync:\n\n' +
        '1. console.cloud.google.com → new project\n' +
        '2. Enable the Gmail API\n' +
        '3. OAuth consent screen → add yourself as a Test user\n' +
        '4. Create OAuth client ID → Desktop app → download JSON\n' +
        '5. Save it as data/gmail-credentials.json\n' +
        '6. Run: npm install googleapis\n\n' +
        'Then reload and click Connect Gmail. Full steps are in the README.'
    );
    return;
  }
  if (state === 'disconnected') {
    window.location = '/api/gmail/connect';
    return;
  }
  // connected -> sync
  gmailEl.disabled = true;
  gmailEl.textContent = 'Syncing Gmail…';
  try {
    const r = await (await fetch('/api/gmail/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    gmailEl.textContent = r.ok ? `+${r.added} new` : 'Sync failed';
  } catch {
    gmailEl.textContent = 'Sync failed';
  }
  setTimeout(refreshGmail, 1600);
  gmailEl.disabled = false;
  load();
});

if (new URLSearchParams(location.search).get('gmail') === 'connected') {
  history.replaceState({}, '', '/');
}
refreshGmail();
// Re-check Gmail status periodically so the auto-sync "+N new" reflects in the
// list while the app is open.
setInterval(() => {
  refreshGmail();
  load();
}, 60000);

let searchTimer;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = searchEl.value.trim();
    load();
  }, 200);
});

sortEl.addEventListener('change', () => {
  const opt = SORT_OPTIONS[state.view][Number(sortEl.value)] || SORT_OPTIONS[state.view][0];
  state.sort = opt.sort;
  state.dir = opt.dir;
  load();
});

statusFilterEl.addEventListener('change', () => {
  state.status = statusFilterEl.value;
  load();
});

tabEls.forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

syncEl.addEventListener('click', async () => {
  syncEl.disabled = true;
  syncEl.textContent = 'Syncing…';
  try {
    const res = await fetch('/api/ingest', { method: 'POST' });
    const r = await res.json();
    syncEl.textContent = `+${r.added} new`;
  } catch {
    syncEl.textContent = 'Sync failed';
  }
  setTimeout(() => {
    syncEl.textContent = 'Sync';
    syncEl.disabled = false;
  }, 1500);
  load();
});

// Allow deep-linking to a view, e.g. /?view=orders
const initialView = new URLSearchParams(location.search).get('view');
if (initialView === 'orders' || initialView === 'sku') {
  state.view = initialView;
  const def = SORT_OPTIONS[state.view][0];
  state.sort = def.sort;
  state.dir = def.dir;
  tabEls.forEach((t) => t.classList.toggle('active', t.dataset.view === state.view));
  panelHintEl.textContent =
    state.view === 'sku'
      ? 'Click a row to expand order-level details.'
      : 'Every order, newest first. Click a row to see its items.';
}

populateSort();
load();
