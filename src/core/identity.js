// Canonical identity keys. Behavioral adaptation — see docs/SOURCE-INVENTORY.md.
// A key identifies producer + bottling name only; vintage is compared
// separately and exactly (null matches only null, never a wildcard).

export const MATCH_KEY_MAX_BYTES = 200;

// Global (g) flag: use with String.prototype.replace only, never .test().
export const FOLD_TO_SPACE = /['`\u2018\u2019\u02BC\-\u2010-\u2014.]/gu;

/**
 * @param {unknown} input
 * @returns {string | null}
 */
export function matchKeyPart(input) {
  if (typeof input !== 'string') return null;
  let s = input.normalize('NFC').normalize('NFKD').replace(/\p{M}/gu, '');
  s = s.toLowerCase();
  s = s.replace(FOLD_TO_SPACE, ' ');
  s = s.replace(/&/gu, ' and ');
  s = s.replace(/\s+/gu, ' ').trim();
  if (!s) return null;
  if (Buffer.byteLength(s, 'utf8') > MATCH_KEY_MAX_BYTES) return null;
  return s;
}

/**
 * @param {unknown} producer
 * @param {unknown} name
 * @returns {{ producer: string, name: string } | null}
 */
export function identityMatchKey(producer, name) {
  const producerKey = matchKeyPart(producer);
  const nameKey = matchKeyPart(name);
  return producerKey && nameKey ? { producer: producerKey, name: nameKey } : null;
}

export function sameKey(a, b) {
  return Boolean(a && b && a.producer === b.producer && a.name === b.name);
}
