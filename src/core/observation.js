// Observation projection and the provisional (uncertainty) predicate.
// Behavioral adaptation — see docs/SOURCE-INVENTORY.md.

import { identityMatchKey } from './identity.js';

// Inherited demo policy, NOT a calibrated probability of correctness.
export const CONFIDENCE_THRESHOLD = 0.6;

const boundedText = (v, max) =>
  typeof v === 'string' ? v.normalize('NFC').trim().slice(0, max) || null : null;

/**
 * Project a raw model identity into the bounded observation shape.
 * A vintage that is not a plausible 4-digit year becomes null (unknown);
 * null is never reinterpreted as non-vintage (NV).
 */
export function projectExtractedIdentity(raw) {
  const currentYear = new Date().getUTCFullYear();
  const rawVintage = raw?.vintage;
  const vintage = typeof rawVintage === 'string' && /^\d{4}$/.test(rawVintage.trim())
    ? Number(rawVintage.trim())
    : rawVintage;
  return {
    producer: boundedText(raw?.producer, 200),
    name: boundedText(raw?.name, 200),
    vintage: Number.isInteger(vintage) && vintage >= 1800 && vintage <= currentYear + 1
      ? vintage
      : null,
    region: boundedText(raw?.region, 120),
    varietal: boundedText(raw?.varietal, 120),
  };
}

export function projectObservation(raw) {
  return {
    ...projectExtractedIdentity(raw),
    is_wine: raw?.is_wine === true,
    confidence: Number.isFinite(raw?.confidence) && raw.confidence >= 0 && raw.confidence <= 1
      ? raw.confidence
      : 0,
  };
}

/**
 * An observation needs provisional handling when its identity key is
 * unusable or its confidence is non-finite, out of range, or below the
 * demo threshold. Provisional observations can never be auto-matched,
 * even when exactly one catalog candidate exists.
 */
export function needsProvisional(raw) {
  const identity = projectExtractedIdentity(raw ?? {});
  return !identityMatchKey(identity.producer, identity.name)
    || !Number.isFinite(raw?.confidence)
    || raw.confidence < CONFIDENCE_THRESHOLD
    || raw.confidence > 1;
}
