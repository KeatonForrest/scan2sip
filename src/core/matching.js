// Exact-match decision over catalog wines. Precedence is normative
// (docs/CONTRACT.md): uncertainty first, then exact key+vintage equality
// across canonical and reviewed alias identities. Null vintage matches
// only an explicitly null-vintage identity — never a year wildcard.

import { identityMatchKey, sameKey } from './identity.js';
import { needsProvisional, projectObservation } from './observation.js';

function identityForms(wine) {
  const forms = [{ producer: wine.producer, name: wine.name, vintage: wine.vintage ?? null }];
  for (const alias of wine.identification_aliases ?? []) {
    forms.push({ producer: alias.producer, name: alias.name, vintage: alias.vintage ?? null });
  }
  return forms;
}

function keyMatches(wine, key) {
  return identityForms(wine).some((f) => sameKey(identityMatchKey(f.producer, f.name), key));
}

function exactMatches(wine, key, vintage) {
  return identityForms(wine).some(
    (f) => sameKey(identityMatchKey(f.producer, f.name), key) && (f.vintage ?? null) === vintage,
  );
}

/**
 * @param {object} raw raw model identification payload
 * @param {Array<object>} wines catalog wines
 * @returns {{ status: string, reason?: string, observation: object, wine?: object }}
 */
export function decideMatch(raw, wines) {
  const observation = projectObservation(raw);
  if (!observation.is_wine) return { status: 'not_wine', observation };
  if (needsProvisional(raw)) return { status: 'provisional', observation };

  const key = identityMatchKey(observation.producer, observation.name);
  const exact = wines.filter((w) => exactMatches(w, key, observation.vintage));
  if (exact.length === 1) return { status: 'matched', observation, wine: exact[0] };
  if (exact.length > 1) return { status: 'ambiguous', observation };

  const keyKnown = wines.some((w) => keyMatches(w, key));
  if (keyKnown) {
    return {
      status: 'missing',
      reason: observation.vintage === null ? 'vintage_required' : 'vintage_mismatch',
      observation,
    };
  }
  return { status: 'missing', reason: 'unknown_wine', observation };
}
