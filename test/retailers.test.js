// Validates the retailer parsers against faithful samples of each email format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmail, parserFor } from '../server/parsers/index.js';

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
