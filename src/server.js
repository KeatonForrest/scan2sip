// Loopback-only Express server for the fixture demo.

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { loadFixtureModel } from './adapters/fixtureModel.js';
import { createService } from './service.js';
import { verifyFixtureIntegrity } from './fixtureIntegrity.js';
import { createIngestion, dedupKeyFor } from './ingestion.js';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const fixturesDir = path.join(root, 'fixtures');

export function buildDemo({
  dbPath = path.join(root, 'data', 'scan2sip.sqlite'),
  fixturesDir: fixturesRoot = fixturesDir,
} = {}) {
  // Startup fails closed on any manifest/schema/hash/scenario-binding
  // problem; nothing is served from unverified fixtures.
  const integrity = verifyFixtureIntegrity(fixturesRoot);
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const store = new Store(dbPath);
  const catalog = JSON.parse(fs.readFileSync(path.join(fixturesRoot, 'catalog.json'), 'utf8'));
  for (const wine of catalog.wines) {
    wine.dedup_key = dedupKeyFor(wine);
    wine.revision = wine.revision ?? 1;
  }
  store.seedWines(catalog.wines);
  // Seed knowledge rows mirror the attributed catalog fields so chat and
  // retrieval treat seed and published wines the same way.
  const seedKnowledge = () => {
    for (const wine of catalog.wines) {
      if (store.getKnowledge(wine.id, wine.revision).length === 0) {
        store.replaceKnowledge(wine.id, wine.revision, Object.entries(wine.fields)
          .filter(([, f]) => f.value != null)
          .map(([field, f]) => ({
            field, value: Array.isArray(f.value) ? f.value.join(', ') : f.value,
            source_id: f.source_id, quote: f.quote,
            classification: 'catalog seed — not a publication review',
          })))
      }
    }
  };
  seedKnowledge();
  const model = loadFixtureModel(integrity.responses);
  const service = createService({ store, model });
  const ingestion = createIngestion({ store, proposalsDoc: integrity.proposalsDoc, fixturesRoot });
  return { store, service, catalog, integrity, fixturesRoot, ingestion, seedKnowledge };
}

export function createApp(demo = buildDemo()) {
  const { store, service } = demo;
  // Everything fixture-derived comes from the verified snapshot/root of
  // this demo instance — never from a default path read a second time.
  const scenarios = demo.integrity?.scenarios
    ?? JSON.parse(fs.readFileSync(path.join(demo.fixturesRoot, 'scenarios.json'), 'utf8')).scenarios;

  const app = express();
  app.use(express.json());
  app.use('/fixtures', express.static(demo.fixturesRoot));
  app.use(express.static(path.join(root, 'web')));

  app.get('/api/fixtures', (_req, res) => res.json({
    scenarios,
    manifest: {
      verified: demo.integrity?.verified === true,
      asset_count: demo.integrity?.entries.length ?? 0,
      assets: (demo.integrity?.entries ?? []).map(({ id, path: p, sha256, kind, scenario }) => (
        { id, path: p, sha256, kind, scenario })),
    },
  }));
  app.get('/api/wines', (_req, res) => res.json({ wines: store.listWines() }));
  app.get('/api/wines/:id', (req, res) => {
    const wine = store.getWine(req.params.id);
    if (!wine) return res.status(404).json({ error: 'wine_not_found' });
    return res.json({ wine });
  });
  app.get('/api/demands', (_req, res) => res.json({ demands: store.listDemands() }));
  const ingestion = demo.ingestion;
  const handle = (fn) => (req, res) => {
    try { return res.json(fn(req)); }
    catch (e) { return res.status(e?.status ?? 400).json({ error: e?.code ?? 'request_failed' }); }
  };
  if (ingestion) {
    app.get('/api/documents', (_req, res) => res.json({ documents: ingestion.documents(), demo_clock: ingestion.getDemoClock() }));
    app.post('/api/documents', handle((req) => ingestion.stage({ document_id: req.body?.document_id, request_id: req.body?.request_id })));
    app.get('/api/artifacts/:id', (req, res) => {
      const artifact = store.getArtifact(req.params.id);
      return artifact ? res.json({ artifact }) : res.status(404).json({ error: 'artifact_not_found' });
    });
    app.post('/api/artifacts/:id/review', handle((req) => ingestion.importReview(req.params.id, req.body ?? {})));
    app.post('/api/publications', handle((req) => ingestion.publish({ artifact_id: req.body?.artifact_id, request_id: req.body?.request_id, review_digest: req.body?.review_digest })));
    app.post('/api/chat', handle((req) => ingestion.chat({ wine_id: req.body?.wine_id, question: req.body?.question, request_id: req.body?.request_id })));
    app.get('/api/regions', (_req, res) => {
      const groups = new Map();
      for (const wine of store.listWines()) {
        const region = wine.fields.region?.value ?? 'Unknown region';
        if (!groups.has(region)) groups.set(region, []);
        groups.get(region).push({
          wine_id: wine.id, producer: wine.producer, name: wine.name,
          vintage: wine.vintage, revision: wine.revision,
        });
      }
      return res.json({ regions: [...groups.entries()].map(([region, wines]) => ({ region, wines })) });
    });
    app.post('/api/demo-clock', handle((req) => {
      if (!req.body?.now || !Number.isFinite(Date.parse(req.body.now))) {
        throw Object.assign(new Error('invalid_clock'), { code: 'invalid_clock', status: 400 });
      }
      return { demo_clock: ingestion.setDemoClock(new Date(req.body.now).toISOString()) };
    }));
  }
  app.post('/api/scans', (req, res) => {
    try {
      const result = service.scan({
        fixture_id: req.body?.fixture_id,
        request_id: req.body?.request_id,
      });
      return res.json(result);
    } catch (e) {
      const status = e?.code === 'unknown_fixture' ? 404 : e?.status ?? 400;
      return res.status(status).json({ error: e?.code ?? 'scan_failed' });
    }
  });
  app.post('/api/reset', (_req, res) => {
    store.reset(demo.catalog.wines);
    demo.seedKnowledge?.();
    return res.json({ reset: true, wines: store.wineCount(), observations: store.observationCount() });
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4173);
  createApp().listen(port, '127.0.0.1', () => {
    console.log(`scan2sip fixture demo (synthetic, no credentials) at http://127.0.0.1:${port}`);
  });
}
