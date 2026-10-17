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
  assert.equal(sable.wine_id, 'wine-sable-and-fern-meadow-white-unknown-vintage');
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

test('same request_id with a different fixture is a conflict and mutates nothing', () => {
  const { service, store } = makeService();
  service.scan({ fixture_id: 'scan-orchard-2021', request_id: 'conflict-1' });
  const before = { obs: store.observationCount(), demands: store.listDemands().length, wines: store.wineCount() };
  assert.throws(
    () => service.scan({ fixture_id: 'scan-unknown-glassfinch', request_id: 'conflict-1' }),
    (e) => e.code === 'request_conflict' && e.status === 409,
  );
  assert.deepEqual(
    { obs: store.observationCount(), demands: store.listDemands().length, wines: store.wineCount() },
    before,
  );
});

test('match then mismatch: mismatch carries no wine and leaves catalog untouched', () => {
  const { service, store } = makeService();
  const matched = service.scan({ fixture_id: 'scan-orchard-2021', request_id: 'seq-1' });
  assert.equal(matched.status, 'matched');
  const mismatch = service.scan({ fixture_id: 'scan-orchard-2022-mismatch', request_id: 'seq-2' });
  assert.equal(mismatch.status, 'missing');
  assert.equal(mismatch.wine_id, undefined);
  assert.equal(store.wineCount(), 4);
});

test('fixture integrity: tampered label bytes fail startup; intact fixtures verify', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan2sip-fixtures-'));
  const fixturesCopy = path.join(tmp, 'fixtures');
  fs.cpSync(path.join(root, 'fixtures'), fixturesCopy, { recursive: true });
  fs.appendFileSync(path.join(fixturesCopy, 'labels', 'label-orchard-2021.svg'), '<!-- tampered -->');
  assert.throws(
    () => buildDemo({ dbPath: ':memory:', fixturesDir: fixturesCopy }),
    (e) => e.code === 'fixture_integrity_failed',
  );
  const ok = buildDemo({ dbPath: ':memory:' });
  assert.equal(ok.integrity.verified, true);
  assert.ok(ok.integrity.entries.length >= 10);
});

async function copyFixtures(mutate) {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const crypto = await import('node:crypto');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan2sip-fixtures-'));
  const fixturesCopy = path.join(tmp, 'fixtures');
  fs.cpSync(path.join(root, 'fixtures'), fixturesCopy, { recursive: true });
  const manifestPath = path.join(fixturesCopy, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const rehash = (relPath) => {
    const entry = manifest.assets.find((e) => e.path === relPath);
    if (entry) entry.sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(tmp, relPath))).digest('hex');
  };
  const save = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  mutate({ fs, tmp, fixturesCopy, manifest, rehash, save });
  save();
  return fixturesCopy;
}

for (const omitted of ['fixtures/responses.json', 'fixtures/catalog.json', 'fixtures/scenarios.json']) {
  test(`fixture integrity: omitted manifest entry for ${omitted} fails startup`, async () => {
    const fixturesCopy = await copyFixtures(({ manifest }) => {
      manifest.assets = manifest.assets.filter((e) => e.path !== omitted);
    });
    assert.throws(
      () => buildDemo({ dbPath: ':memory:', fixturesDir: fixturesCopy }),
      (e) => e.code === 'fixture_integrity_failed' && e.detail.includes(omitted),
    );
  });
}

test('fixture integrity: duplicate manifest path is rejected', async () => {
  const fixturesCopy = await copyFixtures(({ manifest }) => {
    const dup = { ...manifest.assets.find((e) => e.path === 'fixtures/responses.json'), id: 'model-responses-copy' };
    manifest.assets.push(dup);
  });
  assert.throws(
    () => buildDemo({ dbPath: ':memory:', fixturesDir: fixturesCopy }),
    (e) => e.code === 'fixture_integrity_failed' && e.detail.includes('duplicate'),
  );
});

test('fixture integrity: changed authored response without manifest entry cannot be consumed', async () => {
  // The exact defect from re-review: drop the responses entry AND edit
  // the authored producer; startup must fail, never consume it.
  const fixturesCopy = await copyFixtures(({ fs, fixturesCopy: dir, manifest }) => {
    manifest.assets = manifest.assets.filter((e) => e.path !== 'fixtures/responses.json');
    const responsesPath = path.join(dir, 'responses.json');
    const responses = JSON.parse(fs.readFileSync(responsesPath, 'utf8'));
    responses['scan-orchard-2021'].raw.producer = 'Tampered Producer';
    fs.writeFileSync(responsesPath, JSON.stringify(responses, null, 2));
  });
  assert.throws(
    () => buildDemo({ dbPath: ':memory:', fixturesDir: fixturesCopy }),
    (e) => e.code === 'fixture_integrity_failed',
  );
});

test('fixture integrity: scenario label re-bound to another file is rejected', async () => {
  const fixturesCopy = await copyFixtures(({ manifest }) => {
    const entry = manifest.assets.find((e) => e.id === 'label-scan-orchard-2021');
    entry.path = 'fixtures/labels/label-orchard-2022.svg';
  });
  // Recompute the moved entry's hash honestly so only the binding is wrong.
  const fs = await import('node:fs');
  const crypto = await import('node:crypto');
  const manifestPath = path.join(fixturesCopy, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entry = manifest.assets.find((e) => e.id === 'label-scan-orchard-2021');
  entry.sha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(fixturesCopy, 'labels', 'label-orchard-2022.svg'))).digest('hex');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  assert.throws(
    () => buildDemo({ dbPath: ':memory:', fixturesDir: fixturesCopy }),
    (e) => e.code === 'fixture_integrity_failed' && e.detail.includes('label'),
  );
});

test('fixture integrity: malformed manifest entry fails cleanly', async () => {
  const fixturesCopy = await copyFixtures(({ manifest }) => {
    delete manifest.assets[0].sha256;
  });
  assert.throws(
    () => buildDemo({ dbPath: ':memory:', fixturesDir: fixturesCopy }),
    (e) => e.code === 'fixture_integrity_failed',
  );
});

test('createApp serves the verified custom fixtures root, not defaults', async () => {
  const fixturesCopy = await copyFixtures(({ fs, fixturesCopy: dir, rehash }) => {
    const scenariosPath = path.join(dir, 'scenarios.json');
    const doc = JSON.parse(fs.readFileSync(scenariosPath, 'utf8'));
    doc.scenarios[0].title = 'CUSTOM ROOT MARKER';
    fs.writeFileSync(scenariosPath, JSON.stringify(doc, null, 2));
    rehash('fixtures/scenarios.json');
  });
  const demo = buildDemo({ dbPath: ':memory:', fixturesDir: fixturesCopy });
  const app = createApp(demo);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const fixtures = await (await fetch(`${base}/api/fixtures`)).json();
    assert.equal(fixtures.scenarios[0].title, 'CUSTOM ROOT MARKER');
    const label = await fetch(`${base}/fixtures/labels/label-orchard-2021.svg`);
    assert.equal(label.status, 200);
  } finally {
    server.close();
  }
});

test('HTTP shape: flat scan result and verified manifest metadata', async () => {
  const demo = buildDemo({ dbPath: ':memory:' });
  const app = createApp(demo);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const fixtures = await (await fetch(`${base}/api/fixtures`)).json();
    assert.equal(fixtures.manifest.verified, true);
    assert.equal(fixtures.manifest.asset_count, fixtures.manifest.assets.length);
    const scanRes = await fetch(`${base}/api/scans`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'scan-orchard-2021', request_id: 'shape-1' }),
    });
    const scan = await scanRes.json();
    assert.equal(scan.status, 'matched');
    assert.equal(typeof scan.wine_id, 'string');
    assert.equal(scan.demand_created, false);
    const conflict = await fetch(`${base}/api/scans`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'scan-unknown-glassfinch', request_id: 'shape-1' }),
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error, 'request_conflict');
  } finally {
    server.close();
  }
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
