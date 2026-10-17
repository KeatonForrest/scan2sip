// Offline fixture checks (Node 24, node:test). No credentials, no
// provider, no network beyond a loopback HTTP smoke test.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { loadFixtureModel } from '../src/adapters/fixtureModel.js';
import { createService } from '../src/service.js';
import { createApp, buildDemo } from '../src/server.js';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const FIXED_NOW = () => new Date('2026-10-17T12:00:00.000Z');

function makeService() {
  const demo = buildDemo({ dbPath: ':memory:' });
  const service = createService({ store: demo.store, model: loadFixtureModel(path.join(root, 'fixtures', 'responses.json')), now: FIXED_NOW });
  return { ...demo, service };
}

test('correct match: exact wine, per-field attribution preserved', () => {
  const { service, store } = makeService();
  const r = service.scan({ fixture_id: 'scan-orchard-2021', request_id: 't1' });
  assert.equal(r.status, 'matched');
  assert.equal(r.wine_id, 'wine-orchard-lantern-hillside-red-2021');
  const wine = store.getWine(r.wine_id);
  assert.equal(wine.fields.tasting_notes.status, 'AI-generated fixture');
  assert.equal(wine.fields.varietal.status, 'reviewed synthetic source');
  assert.equal(wine.fields.food_pairings.status, 'unknown');
  assert.equal(wine.fields.food_pairings.value, null);
});

test('vintage mismatch never resolves to a different year', () => {
  const { service } = makeService();
  const r = service.scan({ fixture_id: 'scan-orchard-2022-mismatch', request_id: 't2' });
  assert.equal(r.status, 'missing');
  assert.equal(r.reason, 'vintage_mismatch');
  assert.equal(r.wine_id, undefined);
});

test('request replay is idempotent; deliberate rescan creates an observation but no duplicate catalog identity', () => {
  const { service, store } = makeService();
  const first = service.scan({ fixture_id: 'scan-orchard-2021', request_id: 't3' });
  const replay = service.scan({ fixture_id: 'scan-orchard-2021', request_id: 't3' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.wine_id, first.wine_id);
  assert.equal(store.observationCount(), 1);
  const rescan = service.scan({ fixture_id: 'scan-orchard-2021', request_id: 't3-rescan' });
  assert.equal(rescan.status, 'matched');
  assert.equal(store.observationCount(), 2);
  assert.equal(store.wineCount(), 4);
});

test('uncertain observation stays provisional even with exactly one candidate family', () => {
  const { service, store } = makeService();
  const r = service.scan({ fixture_id: 'scan-blurred-orchard', request_id: 't4' });
  assert.equal(r.status, 'provisional');
  assert.equal(r.wine_id, undefined);
  assert.equal(r.demand_created, true);
  assert.equal(store.wineCount(), 4);
});

test('unknown wine is missing, creates deduplicated demand only', () => {
  const { service, store } = makeService();
  const r1 = service.scan({ fixture_id: 'scan-unknown-glassfinch', request_id: 't5a' });
  const r2 = service.scan({ fixture_id: 'scan-unknown-glassfinch', request_id: 't5b' });
  assert.equal(r1.status, 'missing');
  assert.equal(r1.reason, 'unknown_wine');
  assert.equal(r1.demand_created, true);
  assert.equal(r2.demand_created, false);
  assert.equal(store.listDemands().length, 1);
  assert.equal(store.wineCount(), 4);
});

test('missing vintage matches only an explicit null-vintage identity', () => {
  const { service } = makeService();
  const sable = service.scan({ fixture_id: 'scan-novintage-sable', request_id: 't6a' });
  assert.equal(sable.status, 'matched');
  assert.equal(sable.wine_id, 'wine-sable-and-fern-meadow-white-nv');
  const orchard = service.scan({ fixture_id: 'scan-novintage-orchard', request_id: 't6b' });
  assert.equal(orchard.status, 'missing');
  assert.equal(orchard.reason, 'vintage_required');
});

test('not-a-wine is distinct from failure', () => {
  const { service } = makeService();
  const r = service.scan({ fixture_id: 'scan-not-wine', request_id: 't7' });
  assert.equal(r.status, 'not_wine');
});

test('provider failures stay distinct, with no fixture fallback', () => {
  const { service, store } = makeService();
  const err = service.scan({ fixture_id: 'fail-error-response', request_id: 't8a' });
  assert.deepEqual([err.status, err.reason], ['failed', 'provider_error_response']);
  const malformed = service.scan({ fixture_id: 'fail-malformed', request_id: 't8b' });
  assert.deepEqual([malformed.status, malformed.reason], ['failed', 'malformed_response']);
  const timeout = service.scan({ fixture_id: 'fail-timeout', request_id: 't8c' });
  assert.deepEqual([timeout.status, timeout.reason], ['failed', 'provider_timeout_ambiguous']);
  assert.equal(timeout.reservation_retained, true);
  // Replaying the timed-out request returns the retained failure, not a success.
  const replay = service.scan({ fixture_id: 'fail-timeout', request_id: 't8c' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.status, 'failed');
  assert.equal(store.wineCount(), 4);
});

test('HTTP smoke: fixtures, scan, wine details over loopback', async () => {
  const demo = buildDemo({ dbPath: ':memory:' });
  const app = createApp(demo);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const fixtures = await (await fetch(`${base}/api/fixtures`)).json();
    assert.equal(fixtures.scenarios.length, 10);
    const scan = await (await fetch(`${base}/api/scans`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'scan-orchard-2021', request_id: 'http-1' }),
    })).json();
    assert.equal(scan.status, 'matched');
    const wine = await (await fetch(`${base}/api/wines/${scan.wine_id}`)).json();
    assert.equal(wine.wine.fields.varietal.value, 'Syrah');
  } finally {
    server.close();
  }
});
