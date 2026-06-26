// Frontend logic: fetch grouped SKUs, render the Moka-style list, handle
// expand/collapse, search, sort, per-SKU image upload, and re-sync.

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const statsEl = document.getElementById('stats');
const searchEl = document.getElementById('search');
const sortEl = document.getElementById('sort');
const syncEl = document.getElementById('sync');
const imgInput = document.getElementById('imgInput');

let state = { sort: 'orders', dir: 'desc', q: '', open: new Set() };
let pendingImageSku = null;

const money = (n) =>
  (n == null ? 0 : n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name) =>
  esc(String(name || '?').replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?');

async function load() {
  const params = new URLSearchParams({ sort: state.sort, dir: state.dir, q: state.q });
  const res = await fetch(`/api/groups?${params}`);
  const data = await res.json();
  render(data);
}

function render({ groups, totals }) {
  statsEl.innerHTML = `
    <div><span>SKUs</span><b class="num">${totals.skus}</b></div>
    <div><span>Orders</span><b class="num">${totals.orders}</b></div>
    <div><span>Units</span><b class="num">${totals.units}</b></div>
    <div><span>Value</span><b class="num">$${money(totals.value)}</b></div>`;

  emptyEl.hidden = groups.length > 0;
  listEl.innerHTML = groups.map(renderGroup).join('');
  wire();
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
        <div class="grow__sub">SKU: ${esc(g.sku)} · ${g.orderCount} order${g.orderCount === 1 ? '' : 's'} · ${esc(g.retailers.join(', '))}</div>
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
      <td><span class="pill pill--${esc(o.status)}">${esc(o.status)}</span>${o.preorder ? ' <span class="pill">pre-order' + (o.releaseDate ? ' ' + esc(o.releaseDate) : '') + '</span>' : ''}</td>
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
    const sku = groupEl.dataset.sku;

    groupEl.querySelectorAll('[data-toggle]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-img]')) return; // image click handled separately
        if (state.open.has(sku)) state.open.delete(sku);
        else state.open.add(sku);
        load();
      });
    });

    groupEl.querySelectorAll('[data-img]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingImageSku = sku;
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

let searchTimer;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = searchEl.value.trim();
    load();
  }, 200);
});

sortEl.addEventListener('change', () => {
  state.sort = sortEl.value;
  load();
});

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

load();
