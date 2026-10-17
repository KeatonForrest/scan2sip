// Fixture model adapter: authored, deterministic responses keyed by
// fixture id. It never calls a provider, never retries, and never falls
// back to a successful result when a failure fixture is selected.
// Failure modes stay distinct per docs/CONTRACT.md.

import fs from 'node:fs';

export class FixtureTimeoutError extends Error {
  constructor() {
    super('provider_timeout_ambiguous');
    this.code = 'provider_timeout_ambiguous';
    // The simulated attempt's outcome is unknown; its reservation is
    // retained by the service and the request cannot be silently replayed.
    this.ambiguous = true;
  }
}

export function loadFixtureModel(responsesPath) {
  const table = JSON.parse(fs.readFileSync(responsesPath, 'utf8'));
  return {
    /** @returns {object} raw identification payload (possibly malformed, by design) */
    identify(fixtureId) {
      const entry = table[fixtureId];
      if (!entry) {
        const err = new Error('unknown_fixture');
        err.code = 'unknown_fixture';
        throw err;
      }
      if (entry.mode === 'timeout') throw new FixtureTimeoutError();
      if (entry.mode === 'error_response') return { provider_error: entry.error ?? 'simulated_provider_error' };
      // 'ok' and 'malformed' both return their raw payload verbatim; the
      // service's schema validation is what rejects a malformed payload.
      return entry.raw;
    },
  };
}
