// Turn a free-text product name (which differs slightly between retailers) into
// a canonical SKU slug so the same product groups together across stores.
//
// This is intentionally rule-based and conservative. Cross-retailer product
// matching is genuinely hard; the goal here is a sensible default slug that you
// can override with manual aliases (see ALIASES below and data/aliases.json).

const REPLACEMENTS = [
  // Normalize the long franchise/category wording into compact tokens.
  [/trading card game/gi, 'tcg'],
  [/\btcg\b/gi, 'tcg'],
  [/\bpok[eé]mon\b/gi, 'pokemon'],
  [/\bdragon ball super\b/gi, 'dragon-ball-super'],
  [/\bone piece\b/gi, 'one-piece'],
];

// Set/edition codes that retailers tack on but that don't change the product
// identity enough to matter for grouping (e.g. Mr Toys' "ME2.5"). Extend freely.
const STRIP_TOKENS = [
  /\bme\d+(\.\d+)?\b/gi, // ME2.5
];

// Manual canonical overrides keyed by a normalized substring. If a product name
// contains the key, it is forced to the given SKU. Lets you merge stubborn
// cross-retailer naming differences by hand.
const ALIASES = [
  // example: { match: 'ascended heroes booster bundle', sku: 'pokemon-tcg-ascended-heroes-booster-bundle' },
];

export function slugify(str) {
  return String(str || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Compute the canonical SKU for a product name.
 * @param {string} name raw product name from an email
 * @param {Array<{match:string,sku:string}>} [extraAliases] runtime aliases
 * @returns {string} sku slug, e.g. "one-piece-tcg-the-time-of-battle-booster"
 */
export function toSku(name, extraAliases = []) {
  let work = String(name || '').trim();

  const lower = work.toLowerCase();
  for (const alias of [...ALIASES, ...extraAliases]) {
    if (alias && alias.match && lower.includes(alias.match.toLowerCase())) {
      return alias.sku;
    }
  }

  for (const re of STRIP_TOKENS) work = work.replace(re, ' ');
  for (const [re, rep] of REPLACEMENTS) work = work.replace(re, rep);

  return slugify(work);
}

/** Human-friendly display name derived from the raw email name (trimmed/cleaned). */
export function displayName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim();
}
