// Fixture integrity: every consumed asset must be listed in
// fixtures/manifest.json, match the manifest schema, and match its
// recorded SHA-256. Required consumed files (catalog, responses,
// scenarios, and every scenario label) must each be present exactly
// once with the expected kind and a valid content schema. Scenario
// labels and authored responses are bound together so a tampered,
// omitted, duplicated, or mis-bound asset fails startup clearly instead
// of silently replaying. This verifies synthetic fixture bytes only —
// it is not image recognition.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_FIELDS = [
  'id', 'path', 'sha256', 'kind', 'creator', 'creation_method', 'synthetic',
  'rights_basis', 'source_lineage', 'modifications', 'scenario', 'reviewer',
];
const KINDS = new Set([
  'label-image', 'catalog', 'model-response', 'scenario-index', 'document', 'review-artifact',
]);
// Required consumed files, by repository-relative path and expected kind.
const REQUIRED_FILES = new Map([
  ['fixtures/catalog.json', 'catalog'],
  ['fixtures/responses.json', 'model-response'],
  ['fixtures/scenarios.json', 'scenario-index'],
  ['fixtures/documents/proposals.json', 'model-response'],
  ['fixtures/documents/review-playback.example.json', 'review-artifact'],
  ['fixtures/documents/approved-glassfinch-review.json', 'review-artifact'],
]);
const RESPONSE_MODES = new Set(['ok', 'malformed', 'error_response', 'timeout']);

function fail(detail) {
  const err = new Error(`fixture_integrity_failed: ${detail}`);
  err.code = 'fixture_integrity_failed';
  err.detail = detail;
  throw err;
}

const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

function readJson(fixturesDir, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'));
  } catch {
    fail(`${name} is not valid JSON`);
  }
}

function validateCatalog(catalog) {
  if (!isPlainObject(catalog) || !Array.isArray(catalog.wines) || catalog.wines.length === 0) {
    fail('catalog.json schema: expected { wines: non-empty array }');
  }
  const ids = new Set();
  for (const wine of catalog.wines) {
    if (!isPlainObject(wine) || !isNonEmptyString(wine.id)
      || !isNonEmptyString(wine.producer) || !isNonEmptyString(wine.name)
      || !(wine.vintage === null || Number.isInteger(wine.vintage))
      || !isPlainObject(wine.fields)) {
      fail(`catalog.json schema: malformed wine entry ${wine?.id ?? '?'}`);
    }
    if (ids.has(wine.id)) fail(`catalog.json schema: duplicate wine id ${wine.id}`);
    ids.add(wine.id);
  }
}

function validateResponses(responses) {
  if (!isPlainObject(responses) || Object.keys(responses).length === 0) {
    fail('responses.json schema: expected a non-empty object');
  }
  for (const [fixtureId, entry] of Object.entries(responses)) {
    if (!isPlainObject(entry) || !RESPONSE_MODES.has(entry.mode)) {
      fail(`responses.json schema: malformed entry ${fixtureId}`);
    }
    if ((entry.mode === 'ok' || entry.mode === 'malformed') && !isPlainObject(entry.raw)) {
      fail(`responses.json schema: entry ${fixtureId} requires a raw object`);
    }
    if (entry.mode === 'error_response' && !isNonEmptyString(entry.error)) {
      fail(`responses.json schema: entry ${fixtureId} requires an error string`);
    }
  }
}

function validateScenarios(scenariosDoc) {
  if (!isPlainObject(scenariosDoc) || !Array.isArray(scenariosDoc.scenarios)
    || scenariosDoc.scenarios.length === 0) {
    fail('scenarios.json schema: expected { scenarios: non-empty array }');
  }
  const ids = new Set();
  for (const s of scenariosDoc.scenarios) {
    if (!isPlainObject(s) || !isNonEmptyString(s.fixture_id) || !isNonEmptyString(s.label)
      || !isNonEmptyString(s.title) || !isNonEmptyString(s.expect)) {
      fail(`scenarios.json schema: malformed scenario ${s?.fixture_id ?? '?'}`);
    }
    if (ids.has(s.fixture_id)) fail(`scenarios.json schema: duplicate fixture_id ${s.fixture_id}`);
    ids.add(s.fixture_id);
  }
  return scenariosDoc.scenarios;
}

export function verifyFixtureIntegrity(fixturesDir) {
  const manifestPath = path.join(fixturesDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail('manifest.json missing');
  const manifest = readJson(fixturesDir, 'manifest.json');
  if (!isPlainObject(manifest) || !Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    fail('manifest.assets must be a non-empty array');
  }

  const byId = new Map();
  const byPath = new Map();
  manifest.assets.forEach((entry, index) => {
    if (!isPlainObject(entry)) fail(`manifest entry #${index} is not an object`);
    for (const field of REQUIRED_FIELDS) {
      if (!(field in entry)) fail(`entry ${entry.id ?? `#${index}`} missing field ${field}`);
      if (field !== 'synthetic' && !isNonEmptyString(entry[field])) {
        fail(`entry ${entry.id} field ${field} must be a non-empty string`);
      }
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) fail(`entry ${entry.id} has a malformed sha256`);
    if (!KINDS.has(entry.kind)) fail(`entry ${entry.id} has unknown kind ${entry.kind}`);
    if (entry.synthetic !== true) fail(`entry ${entry.id} is not marked synthetic`);
    if (byId.has(entry.id)) fail(`duplicate manifest id ${entry.id}`);
    if (byPath.has(entry.path)) fail(`duplicate manifest path ${entry.path}`);
    byId.set(entry.id, entry);
    byPath.set(entry.path, entry);
    const filePath = path.join(fixturesDir, '..', entry.path);
    if (!fs.existsSync(filePath)) fail(`entry ${entry.id} path missing: ${entry.path}`);
    if (sha256File(filePath) !== entry.sha256) fail(`entry ${entry.id} hash mismatch: ${entry.path}`);
  });

  // Every required consumed file must be present exactly once (the
  // byPath map already rejects duplicates) with its expected kind.
  for (const [requiredPath, expectedKind] of REQUIRED_FILES) {
    const entry = byPath.get(requiredPath);
    if (!entry) fail(`required consumed file missing from manifest: ${requiredPath}`);
    if (entry.kind !== expectedKind) {
      fail(`required file ${requiredPath} must have kind ${expectedKind}, found ${entry.kind}`);
    }
  }

  // Content schemas of the consumed files.
  const catalog = readJson(fixturesDir, 'catalog.json');
  validateCatalog(catalog);
  const responses = readJson(fixturesDir, 'responses.json');
  validateResponses(responses);
  const scenarios = validateScenarios(readJson(fixturesDir, 'scenarios.json'));

  // Bind scenarios to their label assets and authored responses. Each
  // scenario label must be a manifest label-image entry for exactly
  // that path (uniqueness already enforced by byPath).
  for (const scenario of scenarios) {
    const labelPath = `fixtures/${scenario.label}`;
    const labelEntry = byPath.get(labelPath);
    if (!labelEntry) fail(`scenario ${scenario.fixture_id} label missing from manifest: ${labelPath}`);
    if (labelEntry.kind !== 'label-image') {
      fail(`scenario ${scenario.fixture_id} label must be kind label-image, found ${labelEntry.kind}`);
    }
    const named = byId.get(`label-${scenario.fixture_id}`);
    if (!named || named.path !== labelPath) {
      fail(`scenario ${scenario.fixture_id} label is not bound to its manifest entry`);
    }
    if (!(scenario.fixture_id in responses)) {
      fail(`scenario ${scenario.fixture_id} has no authored response`);
    }
  }
  // Milestone-2 consumed sources: the proposals document and every
  // synthetic source sheet it references must be manifest-bound with
  // kind 'document', exactly once (byPath already rejects duplicates).
  const proposalsDoc = readJson(fixturesDir, 'documents/proposals.json');
  if (!isPlainObject(proposalsDoc) || !isPlainObject(proposalsDoc.proposals)
    || Object.keys(proposalsDoc.proposals).length === 0) {
    fail('proposals.json schema: expected { proposals: non-empty object }');
  }
  for (const [documentId, proposal] of Object.entries(proposalsDoc.proposals)) {
    if (!isPlainObject(proposal) || !isNonEmptyString(proposal.document)
      || !isPlainObject(proposal.identity) || !isNonEmptyString(proposal.source_id)) {
      fail(`proposals.json schema: malformed proposal ${documentId}`);
    }
    const docPath = `fixtures/${proposal.document}`;
    const docEntry = byPath.get(docPath);
    if (!docEntry) fail(`proposal ${documentId} document missing from manifest: ${docPath}`);
    if (docEntry.kind !== 'document') {
      fail(`proposal ${documentId} document must be kind document, found ${docEntry.kind}`);
    }
  }
  return { entries: manifest.assets, scenarios, responses, catalog, proposalsDoc, verified: true };
}
