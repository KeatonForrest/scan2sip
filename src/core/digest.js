// Stable canonical digests: SHA-256 over canonical JSON (object keys
// sorted recursively, arrays preserved). Used for source, artifact,
// catalog-snapshot, plan, review, and chat-binding digests.

import crypto from 'node:crypto';

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function digest(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
