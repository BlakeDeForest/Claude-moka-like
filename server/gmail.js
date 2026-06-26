// Live Gmail sync via OAuth 2.0 (read-only).
//
// This is OPTIONAL. The app runs fully without it (seeded db + data/emails).
// To enable automatic pulling of order emails from your Gmail:
//
//   1. Go to https://console.cloud.google.com/ → create a project.
//   2. "APIs & Services" → "Enable APIs" → enable the **Gmail API**.
//   3. "OAuth consent screen" → External → add yourself as a Test user.
//   4. "Credentials" → Create Credentials → OAuth client ID →
//      Application type: **Desktop app**. Download the JSON.
//   5. Save it as  data/gmail-credentials.json  (git-ignored).
//   6. Install the client library once:   npm install googleapis
//   7. Start the app, open it, and click **Connect Gmail**. Approve access.
//      New orders then arrive when you click **Sync Gmail**.
//
// Only the read-only Gmail scope is requested. Tokens are stored locally in
// data/gmail-token.json (git-ignored) and never leave your machine.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const CREDENTIALS_PATH = path.join(DATA_DIR, 'gmail-credentials.json');
const TOKEN_PATH = path.join(DATA_DIR, 'gmail-token.json');

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

// Order-email senders we know how to parse, OR'd together. Extend as needed.
export const GMAIL_QUERY =
  '(' +
  [
    'from:orders.kmart.com.au',
    'from:mrtoys.com.au',
    'from:targetnewsletter.com.au',
    'from:ebgames.com.au',
    'from:global-e.com',
    'from:bigw.com.au',
    'from:toymate.com.au',
    'from:toyworld.com.au',
  ].join(' OR ') +
  ') OR subject:("order confirmation" OR "order confirmed" OR "thanks for your order")';

export function hasCredentials() {
  return fs.existsSync(CREDENTIALS_PATH);
}

export function isConnected() {
  return fs.existsSync(TOKEN_PATH);
}

export function status() {
  return { hasCredentials: hasCredentials(), connected: isConnected() };
}

async function loadGoogle() {
  try {
    const mod = await import('googleapis');
    return mod.google;
  } catch {
    throw new Error(
      'The "googleapis" package is not installed. Run `npm install googleapis` to enable Gmail sync.'
    );
  }
}

function readCredentials() {
  if (!hasCredentials()) {
    throw new Error(
      'Missing data/gmail-credentials.json. See server/gmail.js for one-time Google setup steps.'
    );
  }
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  return raw.installed || raw.web || raw;
}

async function makeClient(redirectUri) {
  const google = await loadGoogle();
  const creds = readCredentials();
  const client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    redirectUri || (creds.redirect_uris && creds.redirect_uris[0])
  );
  // Persist refreshed tokens automatically.
  client.on('tokens', (tokens) => {
    const existing = isConnected() ? JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) : {};
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...existing, ...tokens }, null, 2));
  });
  if (isConnected()) {
    client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
  }
  return client;
}

/** Build the Google consent URL to start the OAuth flow. */
export async function getAuthUrl(redirectUri) {
  const client = await makeClient(redirectUri);
  return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
}

/** Exchange the OAuth code for tokens and persist them. */
export async function handleCallback(code, redirectUri) {
  const client = await makeClient(redirectUri);
  const { tokens } = await client.getToken(code);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  return true;
}

function header(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function decodePart(data) {
  return data ? Buffer.from(data, 'base64url').toString('utf8') : '';
}

// Walk the MIME tree collecting the html and plaintext bodies.
function extractBodies(payload, acc = { html: '', text: '' }) {
  if (!payload) return acc;
  const mime = payload.mimeType || '';
  if (mime === 'text/html' && payload.body && payload.body.data) {
    acc.html += decodePart(payload.body.data);
  } else if (mime === 'text/plain' && payload.body && payload.body.data) {
    acc.text += decodePart(payload.body.data);
  }
  for (const part of payload.parts || []) extractBodies(part, acc);
  return acc;
}

function toEmail(message) {
  const headers = message.payload && message.payload.headers;
  const { html, text } = extractBodies(message.payload);
  const to = header(headers, 'To');
  return {
    id: message.id,
    sender: header(headers, 'From'),
    subject: header(headers, 'Subject'),
    date: header(headers, 'Date') || (message.internalDate ? new Date(Number(message.internalDate)).toISOString() : ''),
    htmlBody: html,
    plaintextBody: text,
    toRecipients: to ? to.split(',').map((s) => s.trim()) : [],
  };
}

/**
 * Fetch order emails from Gmail as normalized email objects.
 * @param {object} [opts] { since: 'YYYY/MM/DD', max: number, redirectUri }
 */
export async function fetchOrderEmails({ since, max = 100, redirectUri } = {}) {
  if (!isConnected()) {
    throw new Error('Gmail is not connected yet. Click "Connect Gmail" first.');
  }
  const google = await loadGoogle();
  const client = await makeClient(redirectUri);
  const gmail = google.gmail({ version: 'v1', auth: client });

  let q = GMAIL_QUERY;
  if (since) q = `(${q}) after:${since}`;

  const emails = [];
  let pageToken;
  do {
    const list = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: Math.min(100, max - emails.length),
      pageToken,
    });
    const ids = (list.data.messages || []).map((m) => m.id);
    for (const id of ids) {
      const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      emails.push(toEmail(msg.data));
      if (emails.length >= max) break;
    }
    pageToken = list.data.nextPageToken;
  } while (pageToken && emails.length < max);

  return emails;
}
