// Validates the retailer parsers against faithful samples of each email format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmail, parserFor } from '../server/parsers/index.js';
import { ingestEmails } from '../server/ingest.js';

test('Target: parses item, qty, prices and order number from plaintext', () => {
  const email = {
    id: 't1',
    sender: 'donotreply@targetnewsletter.com.au',
    subject: 'Thanks for your order Stacey, your Target order is confirmed! Order #563882041',
    date: '2026-05-08T00:16:20Z',
    toRecipients: ['stacey.gates_0315@jezdog.com'],
    plaintextBody: [
      'Target',
      'Thanks for your order Stacey!',
      'Your Order#: 563882041Order Placed: 08/05/2026Receipt#: 55995638820413',
      'Delivery Information:',
      'Pokemon TCG: Triple Whammy Tins - Assorted Item Code: 72979785Unit Price: $30.00',
      'Qty: 1',
      '$30.00',
      'Delivery Fee:$9.00',
      'Order Total',
      '$30.00',
    ].join('\n'),
    htmlBody: '',
  };
  const o = parseEmail(email);
  assert.equal(o.retailer, 'Target');
  assert.equal(o.orderNumber, '563882041');
  assert.equal(o.orderDate, '2026-05-08');
  assert.equal(o.status, 'confirmed');
  assert.equal(o.items.length, 1);
  assert.equal(o.items[0].qty, 1);
  assert.equal(o.items[0].unitPrice, 30);
  assert.equal(o.items[0].sku, 'pokemon-tcg-triple-whammy-tins-assorted');
  assert.equal(o.total, 30);
  assert.equal(o.shipping, 9);
});

test('EB Games: extracts "x N" items, ignores "Have you seen" recommendations', () => {
  const html = `
    <p>Hi Blakey,</p><p>Thanks for your order!</p>
    <p>The balance of your preorder will be taken 1-4 days prior to shipping.</p>
    <div>Delivery Details</div><div>Standard Delivery (Aus Post)</div><div>29 Jan 2027</div>
    <div>x 24</div><div>One Piece - TCG - [EB-06] Booster</div>
    <div>View Order</div><div>Order Number: #10B9BF264AA00E57-A</div>
    <div>Have you seen</div>
    <div>Pokemon - TCG - Mega Evolution Chaos Rising Booster</div>`;
  const o = parseEmail({
    id: 'eb1',
    sender: 'donotreply@ebgames.com.au',
    subject: "Hi Blakey, we've got your order!",
    date: '2026-06-24T00:00:00Z',
    toRecipients: ['blakeyd@jezdog.com'],
    htmlBody: html,
  });
  assert.equal(o.retailer, 'EB Games');
  assert.equal(o.orderNumber, '10B9BF264AA00E57-A');
  assert.equal(o.items.length, 1, 'recommendation must not be counted');
  assert.equal(o.items[0].qty, 24);
  assert.equal(o.items[0].sku, 'one-piece-tcg-eb-06-booster');
  assert.equal(o.items[0].preorder, true);
  assert.equal(o.items[0].releaseDate, '2027-01-29');
});

test('Pokémon Center: parses Global-e order with AU$ totals', () => {
  const html = `
    <div>Order Number: GE12592690351US</div><div>Order Placed: 16/06/2026</div>
    <div>Shipment Items</div>
    <a>Pokémon TCG: Sword & Shield-Astral Radiance Booster Display Box (36 Packs)</a>
    <p>AU$256.99</p><div>Qty: 1</div><div>Not eligible for return</div>
    <div>Shipping Method</div><div>Standard Courier</div>
    <div>Subtotal AU$256.99</div><div>Shipping AU$32.92</div><div>Total AU$289.91</div>`;
  const o = parseEmail({
    id: 'pc1',
    sender: 'do-not-reply@global-e.com',
    subject: 'Order received - Pokémon Center by Global-e - order number GE12592690351US',
    date: '2026-06-16T21:52:46Z',
    toRecipients: ['bdeforest22@jezdog.com'],
    htmlBody: html,
  });
  assert.equal(o.retailer, 'Pokémon Center');
  assert.equal(o.orderNumber, 'GE12592690351US');
  assert.equal(o.items.length, 1);
  assert.equal(o.items[0].qty, 1);
  assert.equal(o.items[0].unitPrice, 256.99);
  assert.equal(o.total, 289.91);
  assert.equal(o.shipping, 32.92);
});

test('Shopify: generic store parser handles "Title × qty" rows', () => {
  const html = `
    <img src="https://cdn.shopify.com/s/files/1/logo.png"/>
    <p>Order #1001</p><p>Thank you for your purchase!</p>
    <p>Charizard ex Premium Collection × 2</p><p>$120.00</p>
    <p>Subtotal $120.00</p><p>Shipping $9.95</p><p>Total $129.95</p>`;
  const email = {
    id: 'sh1',
    sender: '"Aussie Card Shack" <orders@aussiecardshack.myshopify.com>',
    subject: 'Order #1001 confirmed',
    date: '2026-06-20T00:00:00Z',
    toRecipients: ['blake@example.com'],
    htmlBody: html,
  };
  assert.equal(parserFor(email).retailer, 'Shopify store');
  const o = parseEmail(email);
  assert.equal(o.orderNumber, '1001');
  assert.equal(o.items.length, 1);
  assert.equal(o.items[0].qty, 2);
  assert.equal(o.items[0].lineTotal, 120);
  assert.equal(o.total, 129.95);
});

test('Lifecycle: a later shipped email upgrades status and keeps items', () => {
  const db = { orders: {}, skuMeta: {}, aliases: [] };
  const confirm = {
    id: 'k1',
    sender: 'DonotReply.OnlineShop@orders.kmart.com.au',
    subject: 'Order 632783560 Confirmed',
    date: '2026-06-12T00:00:00Z',
    toRecipients: ['robert.smith_6224@jezdog.com'],
    htmlBody:
      '<div>Order number #632783560</div><div>One Piece Booster</div><div>#43792245</div>' +
      '<div>Quantity : 10</div><div>$72.00</div>' +
      '<div>Subtotal $72.00</div><div>Order Total (Incl. GST) $72.00</div>',
  };
  const shipped = {
    id: 'k2',
    sender: 'DonotReply.OnlineShop@orders.kmart.com.au',
    subject: 'Your order 632783560 is shipped',
    date: '2026-06-15T00:00:00Z',
    toRecipients: ['robert.smith_6224@jezdog.com'],
    htmlBody: '<div>Order number #632783560</div>',
  };
  // Ingest out of chronological order on purpose; result must be the same.
  ingestEmails(db, [shipped, confirm]);
  const o = db.orders['kmart-632783560'];
  assert.equal(o.status, 'shipped', 'latest lifecycle status wins');
  assert.equal(o.items.length, 1, 'items from the confirmation are preserved');
  assert.equal(o.items[0].qty, 10);
  assert.equal(o.total, 72);
});

test('Forwarded email: recovers original retailer/sender and parses', () => {
  const fwd = {
    id: 'fwd1',
    sender: 'bdeforest20@gmail.com',
    subject: 'Fwd: Order 999111 Confirmed',
    date: '2026-06-20T00:00:00Z',
    toRecipients: ['me@gmail.com'],
    plaintextBody:
      '---------- Forwarded message ---------\n' +
      'From: <DonotReply.OnlineShop@orders.kmart.com.au>\n' +
      'Date: Fri, Jun 12, 2026 at 2:41 PM\n' +
      'Subject: Order 999111 Confirmed\n' +
      'To: <janet.williams_7296@jezdog.com>\n\nYour order is being prepared',
    htmlBody:
      '<div>Order number #999111</div><div>One Piece Booster</div><div>#43792245</div>' +
      '<div>Quantity : 3</div><div>$30.00</div>' +
      '<div>Subtotal $30.00</div><div>Order Total (Incl. GST) $30.00</div>',
  };
  const o = parseEmail(fwd);
  assert.equal(o.retailer, 'Kmart', 'routed to Kmart despite gmail From header');
  assert.equal(o.orderNumber, '999111');
  assert.equal(o.account, 'janet.williams_7296@jezdog.com', 'original recipient recovered');
  assert.equal(o.items.length, 1);
  assert.equal(o.items[0].qty, 3);
});

test('Generic fallback: only fires with order number + priced item', () => {
  const noItems = {
    id: 'g0',
    sender: 'hello@somestore.com.au',
    subject: 'Your receipt',
    date: '2026-06-20T00:00:00Z',
    toRecipients: [],
    htmlBody: '<p>Thanks for shopping!</p>',
  };
  assert.equal(parseEmail(noItems), null, 'no order number/items => skip');

  const withItems = {
    id: 'g1',
    sender: '"Tiny LGS" <sales@tinylgs.com.au>',
    subject: 'Order #A1234',
    date: '2026-06-20T00:00:00Z',
    toRecipients: [],
    htmlBody: '<p>Order #A1234</p><p>Booster Box × 3</p><p>$300.00</p><p>Total $300.00</p>',
  };
  const o = parseEmail(withItems);
  assert.ok(o, 'should parse when order + priced item present');
  assert.equal(o.orderNumber, 'A1234');
  assert.equal(o.items[0].qty, 3);
});
