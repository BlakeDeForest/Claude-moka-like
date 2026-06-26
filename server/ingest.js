// Ingestion: turn raw emails into stored orders.
//
// Two entry points:
//   - ingestEmails(db, emails)  : parse an array of email objects into the store
//   - ingestFromDir(db, dir)    : read data/emails/*.json|*.html and ingest them
//
// Email object shape (matches what the Gmail API / Gmail MCP returns):
//   { id, sender, subject, date, htmlBody, plaintextBody, toRecipients: [..] }
//
// Run directly:  node server/ingest.js   (ingests data/emails/ into data/db.json)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEmail } from './parsers/index.js';
import { load, save, upsertOrder, DATA_DIR } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMAILS_DIR = path.join(DATA_DIR, 'emails');

/** Parse + upsert an array of emails. Returns { added, updated, skipped }. */
export function ingestEmails(db, emails, aliases = db.aliases || []) {
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const email of emails) {
    let order = null;
    try {
      order = parseEmail(email, aliases);
    } catch (err) {
      console.error(`Parse error for ${email.id || email.subject}:`, err.message);
    }
    if (!order || !order.items.length) {
      skipped++;
      continue;
    }
    if (upsertOrder(db, order)) added++;
    else updated++;
  }
  return { added, updated, skipped };
}

/** Expand a file's contents into an array of email objects. */
function emailsFromFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.json') {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.messages)) return data.messages; // Gmail thread export
    if (Array.isArray(data.emails)) return data.emails;
    return [data];
  }
  if (ext === '.html' || ext === '.htm') {
    // Filename convention: "<retailer-hint>__<anything>.html" so the parser can
    // route by sender. e.g. kmart__632783560.html, mrtoys__W123.html
    const base = path.basename(file).toLowerCase();
    const senderHint = base.includes('mrtoys')
      ? 'sales@mrtoys.com.au'
      : base.includes('kmart')
        ? 'noreply@orders.kmart.com.au'
        : '';
    return [
      {
        id: path.basename(file),
        sender: senderHint,
        subject: path.basename(file, ext),
        date: new Date(fs.statSync(file).mtime).toISOString(),
        htmlBody: fs.readFileSync(file, 'utf8'),
        toRecipients: [],
      },
    ];
  }
  return [];
}

/** Read every email file in `dir` and ingest into `db`. */
export function ingestFromDir(db, dir = EMAILS_DIR) {
  if (!fs.existsSync(dir)) return { added: 0, updated: 0, skipped: 0, files: 0 };
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(json|html?|eml)$/i.test(f))
    .map((f) => path.join(dir, f));
  let totals = { added: 0, updated: 0, skipped: 0, files: files.length };
  for (const file of files) {
    const emails = emailsFromFile(file);
    const r = ingestEmails(db, emails);
    totals.added += r.added;
    totals.updated += r.updated;
    totals.skipped += r.skipped;
  }
  return totals;
}

// CLI entry point.
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = load();
  const r = ingestFromDir(db);
  save(db);
  console.log(
    `Ingested ${r.files} file(s): ${r.added} new, ${r.updated} updated, ${r.skipped} skipped.`
  );
}
