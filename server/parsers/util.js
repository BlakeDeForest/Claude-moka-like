// Shared helpers for turning email HTML into something parseable.

const NAMED_ENTITIES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&rdquo;': '”',
  '&ldquo;': '“',
  '&ndash;': '–',
  '&mdash;': '—',
  '&hellip;': '…',
  '&trade;': '™',
  '&reg;': '®',
};

/** Decode the HTML entities we actually see in retailer emails. */
export function decodeEntities(str) {
  if (!str) return '';
  let out = str;
  for (const [ent, ch] of Object.entries(NAMED_ENTITIES)) {
    out = out.split(ent).join(ch);
  }
  // Numeric entities: &#1234; and &#x1F600;
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCodePoint(parseInt(h, 16)));
  out = out.replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)));
  return out;
}

function safeFromCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/**
 * Flatten HTML into a single line of readable text. We deliberately keep it on
 * one line (collapsing whitespace) because retailer emails wrap line items
 * across many table cells; per-retailer parsers then run regexes over the flat
 * text. Pass `{ block: true }` to instead get newline-separated blocks, which
 * is handy when a parser wants to walk visual rows.
 */
export function htmlToText(html, { block = false } = {}) {
  if (!html) return '';
  let text = html
    // Drop script/style wholesale.
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  if (block) {
    // Convert structural tags to newlines so each cell/row is its own line.
    text = text.replace(/<\/(td|th|tr|p|div|li|h[1-6]|br)\s*>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
  }

  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);

  if (block) {
    return text
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Parse a money string like "$1,234.50" or "1234.5" into a Number (or null). */
export function parseMoney(str) {
  if (str == null) return null;
  const m = String(str).replace(/[^0-9.]/g, '');
  if (m === '' || m === '.') return null;
  const n = Number(m);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a date found in an email into ISO yyyy-mm-dd.
 * Handles dd/mm/yyyy and dd/mm/yy (Australian retailers) plus ISO passthrough.
 */
export function parseDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (dmy) {
    let [, d, mo, y] = dmy;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}
