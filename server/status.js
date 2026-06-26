// Canonical order-status model shared by ingest + grouping.
//
// An order moves through a lifecycle as more emails arrive (placed → shipped →
// delivered), with cancelled/refunded as terminal states. Higher rank wins when
// merging, so a later "shipped" or "cancelled" email upgrades an existing
// "processing" record rather than being overwritten by it.

export const STATUS_RANK = {
  unknown: 0,
  processing: 1,
  confirmed: 1, // retailers call a placed/being-prepared order "confirmed"
  delayed: 1,
  ready: 2, // ready for pickup
  shipped: 3,
  delivered: 4,
  cancelled: 5,
  refunded: 5,
};

export function rank(status) {
  return STATUS_RANK[status] ?? 0;
}

/**
 * Choose the winning status across two versions of the same order.
 * Prefers the higher lifecycle rank; ties break to the later statusDate.
 */
export function pickStatus(a, b) {
  const ra = rank(a.status);
  const rb = rank(b.status);
  if (rb > ra) return b.status;
  if (ra > rb) return a.status;
  return (b.statusDate || '') >= (a.statusDate || '') ? b.status : a.status;
}
