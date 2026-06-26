// Live Gmail sync — OPTIONAL, scaffolded seam.
//
// The MVP works entirely from data/db.json (seeded) and data/emails/ files, so
// you can run the app with no Google setup at all. When you're ready for the
// app to pull new orders by itself, wire this module up:
//
//   1. Create a Google Cloud project, enable the Gmail API, and make an OAuth
//      client (Desktop type). Download the credentials JSON.
//   2. Save it as data/gmail-credentials.json (git-ignored).
//   3. npm install googleapis            (the only external dependency needed)
//   4. Implement fetchOrderEmails() below using googleapis, then call it from
//      a route or a cron. The returned objects must match the email shape that
//      ingestEmails() expects:
//        { id, sender, subject, date, htmlBody, plaintextBody, toRecipients }
//
// SEARCH QUERY: the retailers in scope, OR'd together. Extend as you add stores.
export const GMAIL_QUERY = [
  'from:orders.kmart.com.au',
  'from:mrtoys.com.au',
  'from:toymate.com.au',
  'from:toyworld.com.au',
  'from:bigw.com.au',
].join(' OR ');

export const ENABLED = false; // flip to true once implemented

/**
 * Fetch order emails from Gmail and return them in the normalized email shape.
 * Intentionally unimplemented in the MVP — see the setup notes above.
 *
 * @param {object} [opts] { since: 'YYYY/MM/DD', max: number }
 * @returns {Promise<Array>} email objects ready for ingestEmails()
 */
export async function fetchOrderEmails(/* opts = {} */) {
  throw new Error(
    'Live Gmail sync is not configured. See server/gmail.js for setup steps, ' +
      'or drop email exports into data/emails/ and run `npm run ingest`.'
  );
}
