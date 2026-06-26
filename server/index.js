// Zero-dependency HTTP server: REST API + static frontend.
// Run with:  npm start   (then open http://localhost:3000)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, save, setSkuMeta } from './db.js';
import { groupBySku } from './grouping.js';
import { ingestFromDir } from './ingest.js';
import { listRetailers } from './parsers/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SKU_IMG_DIR = path.join(PUBLIC_DIR, 'images', 'skus');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req, limitBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/gif': '.gif',
};

function saveSkuImage(sku, dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) throw new Error('Expected a base64 data URL');
  const ext = EXT_BY_MIME[m[1]] || '.png';
  fs.mkdirSync(SKU_IMG_DIR, { recursive: true });
  // Remove any prior image for this sku (different extension).
  for (const e of Object.values(EXT_BY_MIME)) {
    const p = path.join(SKU_IMG_DIR, `${sku}${e}`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const filename = `${sku}${ext}`;
  fs.writeFileSync(path.join(SKU_IMG_DIR, filename), Buffer.from(m[2], 'base64'));
  return `/images/skus/${filename}`;
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  // GET /api/groups
  if (req.method === 'GET' && parts[1] === 'groups') {
    const db = load();
    const result = groupBySku(db, {
      sort: url.searchParams.get('sort') || 'orders',
      dir: url.searchParams.get('dir') || 'desc',
      q: url.searchParams.get('q') || '',
    });
    return sendJson(res, 200, result);
  }

  // GET /api/orders
  if (req.method === 'GET' && parts[1] === 'orders') {
    const db = load();
    return sendJson(res, 200, { orders: Object.values(db.orders) });
  }

  // GET /api/retailers
  if (req.method === 'GET' && parts[1] === 'retailers') {
    return sendJson(res, 200, { retailers: listRetailers() });
  }

  // POST /api/ingest  -> ingest data/emails/ (and Gmail later)
  if (req.method === 'POST' && parts[1] === 'ingest') {
    const db = load();
    const r = ingestFromDir(db);
    save(db);
    return sendJson(res, 200, { ok: true, ...r });
  }

  // POST /api/skus/:sku/image   body: { dataUrl }
  if (req.method === 'POST' && parts[1] === 'skus' && parts[3] === 'image') {
    const sku = decodeURIComponent(parts[2]);
    const body = JSON.parse((await readBody(req)) || '{}');
    const imagePath = saveSkuImage(sku, body.dataUrl);
    const db = load();
    setSkuMeta(db, sku, { image: imagePath });
    save(db);
    return sendJson(res, 200, { ok: true, image: imagePath });
  }

  // POST /api/skus/:sku/meta   body: { displayName?, notes? }
  if (req.method === 'POST' && parts[1] === 'skus' && parts[3] === 'meta') {
    const sku = decodeURIComponent(parts[2]);
    const body = JSON.parse((await readBody(req)) || '{}');
    const patch = {};
    if (typeof body.displayName === 'string') patch.displayName = body.displayName;
    if (typeof body.notes === 'string') patch.notes = body.notes;
    const db = load();
    const meta = setSkuMeta(db, sku, patch);
    save(db);
    return sendJson(res, 200, { ok: true, meta });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Moka-like order tracker running at http://localhost:${PORT}\n`);
});
