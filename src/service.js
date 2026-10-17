// Fixture scan service: orchestrates adapter -> decision -> persistence.
// Implements the contract's replay/rescan/failure semantics. No retries,
// no provider calls, no catalog mutation from scans — ever.

import { decideMatch } from './core/matching.js';
import { identityMatchKey } from './core/identity.js';

function isValidIdentification(raw) {
  return Boolean(raw) && typeof raw === 'object'
    && typeof raw.is_wine === 'boolean'
    && (typeof raw.confidence === 'number' || typeof raw.confidence === 'undefined')
    && (raw.producer == null || typeof raw.producer === 'string')
    && (raw.name == null || typeof raw.name === 'string');
}

export function createService({ store, model, now = () => new Date() }) {
  function scan({ fixture_id, request_id }) {
    if (!fixture_id || !request_id) {
      const err = new Error('fixture_id and request_id are required');
      err.code = 'invalid_request';
      throw err;
    }

    // Idempotent replay: same request_id + same fixture returns the
    // recorded result and creates nothing new — including for retained
    // timeout reservations. The same request_id with a DIFFERENT fixture
    // is a conflict, never a replay of another bottle's result.
    const prior = store.getRequest(request_id);
    if (prior) {
      if (prior.fixture_id !== fixture_id) {
        const err = new Error('request_conflict');
        err.code = 'request_conflict';
        err.status = 409;
        throw err;
      }
      return { ...prior.result, replayed: true };
    }

    const created_at = now().toISOString();
    let result;

    let raw;
    try {
      raw = model.identify(fixture_id);
    } catch (e) {
      if (e?.code === 'provider_timeout_ambiguous') {
        result = {
          request_id, fixture_id, status: 'failed', reason: 'provider_timeout_ambiguous',
          reservation_retained: true, observation: null, demand_created: false,
        };
        store.recordRequest({ request_id, fixture_id, status: result.status, result, created_at });
        return result;
      }
      throw e;
    }

    if (raw && typeof raw === 'object' && 'provider_error' in raw) {
      result = {
        request_id, fixture_id, status: 'failed', reason: 'provider_error_response',
        observation: null, demand_created: false,
      };
      store.recordRequest({ request_id, fixture_id, status: result.status, result, created_at });
      return result;
    }

    if (!isValidIdentification(raw)) {
      result = {
        request_id, fixture_id, status: 'failed', reason: 'malformed_response',
        observation: null, demand_created: false,
      };
      store.recordRequest({ request_id, fixture_id, status: result.status, result, created_at });
      return result;
    }

    const decision = decideMatch(raw, store.listWines());
    result = {
      request_id, fixture_id,
      status: decision.status,
      ...(decision.reason ? { reason: decision.reason } : {}),
      observation: decision.observation,
      ...(decision.wine ? { wine_id: decision.wine.id } : {}),
      demand_created: false,
    };

    // Local research demand is the only side effect of an unmatched or
    // provisional scan, and only with a usable canonical identity key.
    if (decision.status === 'provisional' || (decision.status === 'missing')) {
      const key = identityMatchKey(decision.observation.producer, decision.observation.name);
      if (key) {
        const { created } = store.addDemand({
          subject_key: `${key.producer}::${key.name}::${decision.observation.vintage ?? 'unknown'}`,
          utc_day: created_at.slice(0, 10),
          producer: decision.observation.producer,
          name: decision.observation.name,
          vintage: decision.observation.vintage,
        });
        result.demand_created = created;
      }
    }

    store.recordRequest({ request_id, fixture_id, status: result.status, result, created_at });
    return result;
  }

  return { scan };
}
