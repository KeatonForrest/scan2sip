// Deterministic fixture evaluator. Exercises the actual HTTP API and
// service (no mirrored logic), with fixed request ids and the pinned
// demo clock. Output contains no wall timings and no absolute paths.
// It reports functional fixture outcomes only — never model accuracy
// or provider performance (provider latency is N/A in fixture mode).
//
//   node evaluation/evaluate.mjs           # write evaluation/results.json
//   node evaluation/evaluate.mjs --check   # recompute and compare

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemo, createApp } from '../src/server.js';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const checkMode = process.argv.includes('--check');

const demo = buildDemo({ dbPath: ':memory:' });
const server = createApp(demo).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function req(method, p, body) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const scan = (fixture_id, request_id) => req('POST', '/api/scans', { fixture_id, request_id });

const cases = [];
function record(id, title, expected, observed) {
  cases.push({ id, title, expected, observed, pass: JSON.stringify(expected) === JSON.stringify(observed) });
}

try {
  // 1. Correct catalog match with per-field attribution.
  const match = await scan('scan-orchard-2021', 'eval-match');
  const matchWine = (await req('GET', `/api/wines/${match.body.wine_id}`)).body.wine;
  record('match', 'Correct catalog match', {
    status: 'matched', wine_id: 'wine-orchard-lantern-hillside-red-2021',
    varietal_status: 'reviewed synthetic source', tasting_status: 'AI-generated fixture',
  }, {
    status: match.body.status, wine_id: match.body.wine_id,
    varietal_status: matchWine.fields.varietal.status, tasting_status: matchWine.fields.tasting_notes.status,
  });

  // 2. Vintage mismatch never substitutes another year.
  const mismatch = await scan('scan-orchard-2022-mismatch', 'eval-mismatch');
  record('vintage-mismatch', 'Vintage mismatch', { status: 'missing', reason: 'vintage_mismatch' },
    { status: mismatch.body.status, reason: mismatch.body.reason });

  // 3. Request replay is idempotent.
  const replay = await scan('scan-orchard-2021', 'eval-match');
  record('request-replay', 'Same request replayed', { replayed: true, status: 'matched' },
    { replayed: replay.body.replayed === true, status: replay.body.status });

  // 4. Deliberate rescan: new observation, no duplicate catalog identity.
  const rescan = await scan('scan-orchard-2021', 'eval-rescan');
  const winesAfterRescan = (await req('GET', '/api/wines')).body.wines;
  record('duplicate-rescan', 'Rescan duplicates no catalog identity', { status: 'matched', wine_count: 4 },
    { status: rescan.body.status, wine_count: winesAfterRescan.length });

  // 5. Unknown wine: missing + local demand only.
  const unknown = await scan('scan-unknown-glassfinch', 'eval-unknown');
  record('unknown-wine', 'Unknown wine', { status: 'missing', reason: 'unknown_wine', demand_created: true },
    { status: unknown.body.status, reason: unknown.body.reason, demand_created: unknown.body.demand_created });

  // 6. Uncertainty stays provisional even with a candidate family present.
  const blurred = await scan('scan-blurred-orchard', 'eval-blurred');
  record('uncertainty', 'Uncertain scan is provisional', { status: 'provisional' },
    { status: blurred.body.status });

  // 7. Missing vintage: never a wildcard, never NV; explicit null identity matches.
  const noVintage = await scan('scan-novintage-orchard', 'eval-novintage');
  const sable = await scan('scan-novintage-sable', 'eval-novintage-sable');
  record('missing-vintage', 'Missing vintage semantics', {
    orchard: 'vintage_required', sable: 'matched',
  }, {
    orchard: noVintage.body.reason, sable: sable.body.status,
  });

  // 8. Missing fields stay unknown; AI notes stay AI-only.
  record('missing-fields', 'Missing fields and AI-only notes', {
    food_pairings: ['unknown', null], tasting_notes_status: 'AI-generated fixture',
  }, {
    food_pairings: [matchWine.fields.food_pairings.status, matchWine.fields.food_pairings.value],
    tasting_notes_status: matchWine.fields.tasting_notes.status,
  });

  // 9. Simulated provider failures stay distinct.
  const failError = await scan('fail-error-response', 'eval-fail-error');
  const failMalformed = await scan('fail-malformed', 'eval-fail-malformed');
  const failTimeout = await scan('fail-timeout', 'eval-fail-timeout');
  record('provider-failures', 'Simulated provider failures', {
    error_response: 'provider_error_response', malformed: 'malformed_response', timeout: 'provider_timeout_ambiguous',
  }, {
    error_response: failError.body.reason, malformed: failMalformed.body.reason, timeout: failTimeout.body.reason,
  });

  // 10. Staging + rejected/unsupported evidence.
  const staged = await req('POST', '/api/documents', { document_id: 'glassfinch-aurelia-white', request_id: 'eval-stage' });
  const support = Object.fromEntries(staged.body.fields.map((f) => [f.field, f.support]));
  const undated = await req('POST', '/api/documents', { document_id: 'glassfinch-aurelia-white-undated', request_id: 'eval-stage-undated' });
  record('rejected-evidence', 'Unsupported evidence and held undated artifact', {
    food_pairings: 'unsupported', tasting_notes: 'absent', undated_status: 'held', undated_reason: 'vintage_required',
  }, {
    food_pairings: support.food_pairings, tasting_notes: support.tasting_notes,
    undated_status: undated.body.status, undated_reason: undated.body.reason,
  });

  // 11. Independent review binding (exact approved artifact, pinned).
  const approved = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/documents/approved-glassfinch-review.json'), 'utf8'));
  const review = await req('POST', `/api/artifacts/${staged.body.artifact_id}/review`, { review: approved });
  record('independent-review', 'Approved review binding', {
    classification: 'independently-reviewed',
    review_digest: '9dff1bcb0ea54ea53263856c3bd891c6aea8eb6dec773f54bb2c7044601a8189',
    accepted_fields: ['producer_info', 'region', 'varietal'],
  }, {
    classification: review.body.classification, review_digest: review.body.review_digest,
    accepted_fields: review.body.accepted_fields,
  });

  // 12. Atomic publication + retrieval/chat on the exact wine revision.
  const published = await req('POST', '/api/publications', {
    artifact_id: staged.body.artifact_id, request_id: 'eval-publish', review_digest: review.body.review_digest,
  });
  const publishedWine = (await req('GET', `/api/wines/${published.body.wine_id}`)).body.wine;
  const chatRegion = await req('POST', '/api/chat', { wine_id: published.body.wine_id, question: 'Where is this wine from?', request_id: 'eval-chat-region' });
  const chatGrape = await req('POST', '/api/chat', { wine_id: published.body.wine_id, question: 'What grape is it made from?', request_id: 'eval-chat-grape' });
  const chatUnknown = await req('POST', '/api/chat', { wine_id: published.body.wine_id, question: 'What food should I serve?', request_id: 'eval-chat-unknown' });
  record('publication-chat', 'Publication, retrieval and exact-wine chat', {
    publish_status: 'published', review_classification: 'independently-reviewed',
    field_status: 'reviewed synthetic source', field_classification: 'independently-reviewed',
    chat_region: ['answered', 'region', 1], chat_grape_field: 'varietal', chat_unknown: 'unknown',
  }, {
    publish_status: published.body.status, review_classification: published.body.review_classification,
    field_status: publishedWine.fields.region.status, field_classification: publishedWine.fields.region.review_classification,
    chat_region: [chatRegion.body.evidence_status, chatRegion.body.citations[0]?.field, chatRegion.body.revision],
    chat_grape_field: chatGrape.body.citations[0]?.field, chat_unknown: chatUnknown.body.evidence_status,
  });

  // 13. Duplicate publication changes nothing.
  const duplicate = await req('POST', '/api/publications', {
    artifact_id: staged.body.artifact_id, request_id: 'eval-publish-duplicate', review_digest: review.body.review_digest,
  });
  const wineCountFinal = (await req('GET', '/api/wines')).body.wines.length;
  record('duplicate-publication', 'Duplicate publication', {
    status: 'already_published', changed: false, wine_count: 5,
  }, { status: duplicate.body.status, changed: duplicate.body.changed, wine_count: wineCountFinal });

  // 14. Rescan of the formerly unknown wine now matches the published record.
  const rescanPublished = await scan('scan-unknown-glassfinch', 'eval-rescan-published');
  record('rescan-published', 'Rescan after publication', { status: 'matched', wine_id: published.body.wine_id },
    { status: rescanPublished.body.status, wine_id: rescanPublished.body.wine_id });
} finally {
  server.close();
}

const manifestSha = crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(root, 'fixtures/manifest.json'))).digest('hex');
const results = {
  schema: 'scan2sip-evaluation-v1',
  mode: 'fixture (simulated provider output; provider latency N/A; no model-accuracy or provider-performance claim)',
  fixture_manifest_sha256: manifestSha,
  case_count: cases.length,
  passed: cases.filter((c) => c.pass).length,
  cases,
};

const outPath = path.join(root, 'evaluation/results.json');
const serialized = JSON.stringify(results, null, 2) + '\n';
if (checkMode) {
  const committed = fs.readFileSync(outPath, 'utf8');
  if (committed !== serialized) {
    console.error('evaluation results differ from committed evaluation/results.json');
    process.exit(1);
  }
  console.log(`eval --check OK: ${results.passed}/${results.case_count} cases, manifest ${manifestSha.slice(0, 12)}…`);
} else {
  fs.writeFileSync(outPath, serialized);
  console.log(`eval: ${results.passed}/${results.case_count} cases passed; wrote evaluation/results.json`);
}
if (results.passed !== results.case_count) process.exit(1);
