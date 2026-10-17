// Fixture integrity: every consumed asset must be listed in
// fixtures/manifest.json, match the manifest schema, and match its
// recorded SHA-256. Scenario labels and authored responses are bound
// together so a tampered or missing asset fails startup clearly instead
// of silently replaying. This verifies synthetic fixture bytes only —
// it is not image recognition.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_FIELDS = [
  'id', 'path', 'sha256', 'kind', 'creator', 'creation_method', 'synthetic',
  'rights_basis', 'source_lineage', 'modifications', 'scenario', 'reviewer',
];
const KINDS = new Set(['label-image', 'catalog', 'model-response', 'document', 'review-artifact']);

function fail(detail) {
  const err = new Error(`fixture_integrity_failed: ${detail}`);
  err.code = 'fixture_integrity_failed';
  err.detail = detail;
  throw err;
}

const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

export function verifyFixtureIntegrity(fixturesDir) {
  const manifestPath = path.join(fixturesDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail('manifest.json missing');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    fail('manifest.json is not valid JSON');
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    fail('manifest.assets must be a non-empty array');
  }

  const byId = new Map();
  for (const entry of manifest.assets) {
    for (const field of REQUIRED_FIELDS) {
      if (!(field in entry)) fail(`entry ${entry.id ?? '?'} missing field ${field}`);
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) fail(`entry ${entry.id} has a malformed sha256`);
    if (!KINDS.has(entry.kind)) fail(`entry ${entry.id} has unknown kind ${entry.kind}`);
    if (entry.synthetic !== true) fail(`entry ${entry.id} is not marked synthetic`);
    if (byId.has(entry.id)) fail(`duplicate manifest id ${entry.id}`);
    byId.set(entry.id, entry);
    const filePath = path.join(fixturesDir, '..', entry.path);
    if (!fs.existsSync(filePath)) fail(`entry ${entry.id} path missing: ${entry.path}`);
    if (sha256File(filePath) !== entry.sha256) fail(`entry ${entry.id} hash mismatch: ${entry.path}`);
  }

  // Bind scenarios to their label assets and authored responses.
  const scenarios = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'scenarios.json'), 'utf8')).scenarios;
  const responses = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'responses.json'), 'utf8'));
  for (const scenario of scenarios) {
    const labelEntry = byId.get(`label-${scenario.fixture_id}`);
    if (!labelEntry) fail(`scenario ${scenario.fixture_id} has no manifest label entry`);
    if (labelEntry.path !== `fixtures/${scenario.label}`) {
      fail(`scenario ${scenario.fixture_id} label is not bound to its manifest entry`);
    }
    if (!(scenario.fixture_id in responses)) {
      fail(`scenario ${scenario.fixture_id} has no authored response`);
    }
  }
  return { entries: manifest.assets, scenarios, responses, verified: true };
}
