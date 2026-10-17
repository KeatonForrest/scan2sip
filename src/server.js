// Loopback-only Express server for the fixture demo.

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { loadFixtureModel } from './adapters/fixtureModel.js';
import { createService } from './service.js';
import { verifyFixtureIntegrity } from './fixtureIntegrity.js';

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
  store.seedWines(catalog.wines);
  const model = loadFixtureModel(integrity.responses);
  const service = createService({ store, model });
  return { store, service, catalog, integrity };
}

export function createApp(demo = buildDemo()) {
  const { store, service } = demo;
  const scenarios = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'scenarios.json'), 'utf8'),
  ).scenarios;

  const app = express();
  app.use(express.json());
  app.use('/fixtures', express.static(fixturesDir));
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
