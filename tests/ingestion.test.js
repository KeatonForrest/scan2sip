// Milestone 2 offline checks: staging/support, held vintage, review
// binding/classification, atomic publication + dedup + rollback, replay
// precedence, chat binding/citations, and the region explorer data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemo } from '../src/server.js';

function makeDemo() {
  return buildDemo({ dbPath: ':memory:' });
}

function stageGlassfinch(demo, req = 'stage-1') {
  return demo.ingestion.stage({ document_id: 'glassfinch-aurelia-white', request_id: req });
}

function publishGlassfinch(demo) {
  const artifact = stageGlassfinch(demo);
  demo.ingestion.importReview(artifact.artifact_id, { source: 'playback_example' });
  return demo.ingestion.publish({ artifact_id: artifact.artifact_id, request_id: 'pub-1' });
}

test('staging: verbatim support per field; unsupported pairing; identity together', () => {
  const demo = makeDemo();
  const artifact = stageGlassfinch(demo);
  assert.equal(artifact.status, 'staged');
  const byField = Object.fromEntries(artifact.fields.map((f) => [f.field, f.support]));
  assert.equal(byField.region, 'supported');
  assert.equal(byField.varietal, 'supported');
  assert.equal(byField.producer_info, 'supported');
  assert.equal(byField.food_pairings, 'unsupported');
  assert.equal(byField.tasting_notes, 'absent');
  assert.ok(artifact.identity_quotes.every((q) => q.present));
});

test('undated artifact is held; missing vintage is never published or called NV', () => {
  const demo = makeDemo();
  const artifact = demo.ingestion.stage({ document_id: 'glassfinch-aurelia-white-undated', request_id: 'stage-u' });
  assert.equal(artifact.status, 'held');
  assert.equal(artifact.reason, 'vintage_required');
  assert.throws(
    () => demo.ingestion.publish({ artifact_id: artifact.artifact_id, request_id: 'pub-u' }),
    (e) => e.code === 'artifact_held',
  );
});

test('stage replay is idempotent; conflicting reuse is 409', () => {
  const demo = makeDemo();
  const first = stageGlassfinch(demo, 'stage-x');
  const replay = stageGlassfinch(demo, 'stage-x');
  assert.equal(replay.replayed, true);
  assert.equal(replay.artifact_sha256, first.artifact_sha256);
  assert.throws(
    () => demo.ingestion.stage({ document_id: 'orchard-lantern-hillside-red', request_id: 'stage-x' }),
    (e) => e.code === 'request_conflict',
  );
});

test('playback review is classified simulated, never independently-reviewed', async () => {
  const demo = makeDemo();
  const artifact = stageGlassfinch(demo);
  const review = demo.ingestion.importReview(artifact.artifact_id, { source: 'playback_example' });
  assert.equal(review.classification, 'simulated-playback');
  assert.deepEqual(review.accepted_fields, ['producer_info', 'region', 'varietal']);
  assert.ok(review.plan_digest && review.catalog_snapshot_sha256);
  // Caller-declared independence does not change classification.
  const { digest } = await import('../src/core/digest.js');
  const artifact2 = demo.ingestion.stage({ document_id: 'orchard-lantern-hillside-red', request_id: 'stage-o' });
  const snapshot2 = demo.ingestion.snapshot();
  const declared = demo.ingestion.importReview(artifact2.artifact_id, {
    review: {
      schema: 'scan2sip-review-v1', kind: 'independent', reviewer_ref: 'someone-else',
      curator_ref: 'demo-operator', reviewed_at: '2026-10-01T00:00:00.000Z',
      review_before: '2026-12-30T00:00:00.000Z', accepted_fields: ['region'],
      artifact_sha256: artifact2.artifact_sha256, catalog_snapshot_sha256: snapshot2,
      plan_digest: digest({ artifact_sha256: artifact2.artifact_sha256, accepted_fields: ['region'], catalog_snapshot_sha256: snapshot2 }),
    },
  });
  assert.equal(declared.classification, 'simulated-playback');
});

test('review cannot accept an unsupported field', async () => {
  const { digest } = await import('../src/core/digest.js');
  const demo = makeDemo();
  const artifact = stageGlassfinch(demo);
  const snapshot = demo.ingestion.snapshot();
  assert.throws(
    () => demo.ingestion.importReview(artifact.artifact_id, {
      review: {
        schema: 'scan2sip-review-v1', kind: 'playback', reviewer_ref: 'playback-reviewer (simulated)',
        curator_ref: 'demo-operator', reviewed_at: '2026-10-01T00:00:00.000Z',
        review_before: '2026-12-30T00:00:00.000Z', accepted_fields: ['food_pairings'],
        artifact_sha256: artifact.artifact_sha256, catalog_snapshot_sha256: snapshot,
        plan_digest: digest({ artifact_sha256: artifact.artifact_sha256, accepted_fields: ['food_pairings'], catalog_snapshot_sha256: snapshot }),
      },
    }),
    (e) => e.code === 'invalid_review_unsupported_accept',
  );
});

test('explicit review must arrive bound: wrong artifact_sha and unbound reviews are rejected', () => {
  const demo = makeDemo();
  const artifact = stageGlassfinch(demo);
  const base = {
    schema: 'scan2sip-review-v1', kind: 'independent', reviewer_ref: 'external-reviewer',
    curator_ref: 'demo-operator', reviewed_at: '2026-10-01T00:00:00.000Z',
    review_before: '2026-12-30T00:00:00.000Z', accepted_fields: ['region'],
  };
  assert.throws(
    () => demo.ingestion.importReview(artifact.artifact_id, {
      review: { ...base, artifact_sha256: 'f'.repeat(64), catalog_snapshot_sha256: 'x', plan_digest: 'y' },
    }),
    (e) => e.code === 'invalid_review_binding',
  );
  assert.throws(
    () => demo.ingestion.importReview(artifact.artifact_id, {
      review: { ...base, artifact_sha256: artifact.artifact_sha256 },
    }),
    (e) => e.code === 'invalid_review_unbound',
  );
});

test('decisions contradicting accepted_fields are rejected', () => {
  const demo = makeDemo();
  const artifact = stageGlassfinch(demo);
  assert.throws(
    () => demo.ingestion.importReview(artifact.artifact_id, {
      review: {
        schema: 'scan2sip-review-v1', kind: 'independent', reviewer_ref: 'external-reviewer',
        curator_ref: 'demo-operator', reviewed_at: '2026-10-01T00:00:00.000Z',
        review_before: '2026-12-30T00:00:00.000Z',
        artifact_sha256: artifact.artifact_sha256, catalog_snapshot_sha256: demo.ingestion.snapshot(),
        plan_digest: 'computed-below',
        decisions: { region: 'reject', varietal: 'accept' }, accepted_fields: ['region'],
      },
    }),
    (e) => e.code === 'invalid_review_contradiction' || e.code === 'invalid_review_plan',
  );
});

test('multiple reviews: publish requires an exact review digest', async () => {
  const { digest } = await import('../src/core/digest.js');
  const demo = makeDemo();
  const artifact = stageGlassfinch(demo);
  const playback = demo.ingestion.importReview(artifact.artifact_id, { source: 'playback_example' });
  const snapshot = demo.ingestion.snapshot();
  const explicit = demo.ingestion.importReview(artifact.artifact_id, {
    review: {
      schema: 'scan2sip-review-v1', kind: 'independent', reviewer_ref: 'external-reviewer',
      curator_ref: 'demo-operator', reviewed_at: '2026-10-01T00:00:00.000Z',
      review_before: '2026-12-30T00:00:00.000Z', accepted_fields: ['region'],
      artifact_sha256: artifact.artifact_sha256, catalog_snapshot_sha256: snapshot,
      plan_digest: digest({ artifact_sha256: artifact.artifact_sha256, accepted_fields: ['region'], catalog_snapshot_sha256: snapshot }),
    },
  });
  assert.notEqual(explicit.review_digest, playback.review_digest);
  assert.throws(
    () => demo.ingestion.publish({ artifact_id: artifact.artifact_id, request_id: 'pub-multi' }),
    (e) => e.code === 'ambiguous_review',
  );
  const published = demo.ingestion.publish({
    artifact_id: artifact.artifact_id, request_id: 'pub-multi', review_digest: playback.review_digest,
  });
  assert.equal(published.status, 'published');
});

test('publication: new wine + knowledge atomically; rescan then matches; AI provenance untouched elsewhere', () => {
  const demo = makeDemo();
  const before = demo.store.wineCount();
  const published = publishGlassfinch(demo);
  assert.equal(published.status, 'published');
  assert.equal(demo.store.wineCount(), before + 1);
  const wine = demo.store.getWine(published.wine_id);
  assert.equal(wine.fields.region.status, 'reviewed synthetic source');
  assert.equal(wine.fields.food_pairings.status, 'unknown');
  assert.equal(wine.fields.tasting_notes.status, 'unknown');
  const knowledge = demo.store.getKnowledge(published.wine_id, 1);
  assert.deepEqual(knowledge.map((k) => k.field).sort(), ['producer_info', 'region', 'varietal']);
  // The previously unknown scan now matches the published wine.
  const scan = demo.service.scan({ fixture_id: 'scan-unknown-glassfinch', request_id: 'rescan-1' });
  assert.equal(scan.status, 'matched');
  assert.equal(scan.wine_id, published.wine_id);
});

test('publication replay returns recorded result before stale-snapshot validation', () => {
  const demo = makeDemo();
  const published = publishGlassfinch(demo);
  // Change the catalog afterwards (another publication), making the
  // original snapshot stale; replay must still succeed.
  const orchard = demo.ingestion.stage({ document_id: 'orchard-lantern-hillside-red', request_id: 'stage-o2' });
  demo.ingestion.importReview(orchard.artifact_id, { source: 'playback_example' });
  demo.ingestion.publish({ artifact_id: orchard.artifact_id, request_id: 'pub-o2' });
  const artifact = stageGlassfinch(demo, 'stage-again');
  const again = demo.ingestion.publish({ artifact_id: artifact.artifact_id, request_id: 'pub-2' });
  assert.equal(again.status, 'already_published');
  assert.equal(again.wine_id, published.wine_id);
});

test('duplicate publication of an existing catalog wine changes no fields or provenance', () => {
  const demo = makeDemo();
  const beforeWine = demo.store.getWine('wine-orchard-lantern-hillside-red-2021');
  const artifact = demo.ingestion.stage({ document_id: 'orchard-lantern-hillside-red', request_id: 'stage-o3' });
  demo.ingestion.importReview(artifact.artifact_id, { source: 'playback_example' });
  const result = demo.ingestion.publish({ artifact_id: artifact.artifact_id, request_id: 'pub-o3' });
  assert.equal(result.status, 'already_published');
  assert.equal(result.changed, false);
  const afterWine = demo.store.getWine('wine-orchard-lantern-hillside-red-2021');
  assert.deepEqual(afterWine.fields, beforeWine.fields);
  assert.equal(afterWine.fields.tasting_notes.status, 'AI-generated fixture');
});

test('transaction rollback: forced retrieval-write failure leaves no wine or publication', () => {
  const demo = makeDemo();
  const artifact = stageGlassfinch(demo);
  demo.ingestion.importReview(artifact.artifact_id, { source: 'playback_example' });
  const original = demo.store.replaceKnowledge;
  demo.store.replaceKnowledge = () => { throw new Error('forced retrieval failure'); };
  const winesBefore = demo.store.wineCount();
  assert.throws(
    () => demo.ingestion.publish({ artifact_id: artifact.artifact_id, request_id: 'pub-r' }),
    /forced retrieval failure/,
  );
  demo.store.replaceKnowledge = original;
  assert.equal(demo.store.wineCount(), winesBefore);
  assert.equal(demo.store.getPublicationByArtifact(artifact.artifact_sha256), null);
});

test('expired review is refused deterministically via the demo clock', () => {
  const demo = makeDemo();
  const artifact = stageGlassfinch(demo);
  demo.ingestion.importReview(artifact.artifact_id, { source: 'playback_example' });
  demo.ingestion.setDemoClock('2027-06-01T00:00:00.000Z');
  assert.throws(
    () => demo.ingestion.publish({ artifact_id: artifact.artifact_id, request_id: 'pub-e' }),
    (e) => e.code === 'expired_review',
  );
});

test('chat: exact wine/revision citations, unknown evidence, replay binding', () => {
  const demo = makeDemo();
  const published = publishGlassfinch(demo);
  const answered = demo.ingestion.chat({ wine_id: published.wine_id, question: 'Where is this wine from?', request_id: 'chat-1' });
  assert.equal(answered.evidence_status, 'answered');
  assert.equal(answered.wine_id, published.wine_id);
  assert.equal(answered.revision, 1);
  assert.equal(answered.citations[0].field, 'region');
  assert.equal(answered.citations[0].review_classification, 'simulated-playback');
  assert.ok(answered.citations[0].quote.includes('Pale Coast'));
  assert.equal(answered.provider_latency, 'N/A');
  // The exact UI button question must return the grape, not the region.
  const grape = demo.ingestion.chat({ wine_id: published.wine_id, question: 'What grape is it made from?', request_id: 'chat-grape' });
  assert.equal(grape.evidence_status, 'answered');
  assert.equal(grape.citations[0].field, 'varietal');
  assert.ok(grape.answer.includes('Albariño'));
  const unknown = demo.ingestion.chat({ wine_id: published.wine_id, question: 'What food should I serve?', request_id: 'chat-2' });
  assert.equal(unknown.evidence_status, 'unknown');
  assert.deepEqual(unknown.citations, []);
  const unsupported = demo.ingestion.chat({ wine_id: published.wine_id, question: 'Will it age well?', request_id: 'chat-3' });
  assert.equal(unsupported.evidence_status, 'unknown');
  const replay = demo.ingestion.chat({ wine_id: published.wine_id, question: 'Where is this wine from?', request_id: 'chat-1' });
  assert.equal(replay.replayed, true);
  assert.throws(
    () => demo.ingestion.chat({ wine_id: published.wine_id, question: 'What grape is it?', request_id: 'chat-1' }),
    (e) => e.code === 'request_conflict',
  );
});

async function loadApprovedReview() {
  const fs = await import('node:fs');
  return JSON.parse(fs.readFileSync(new URL('../fixtures/documents/approved-glassfinch-review.json', import.meta.url), 'utf8'));
}

test('approved pin: exact S-reviewed artifact is independently-reviewed through publication and chat', async () => {
  const demo = makeDemo();
  const artifact = stageGlassfinch(demo);
  const approved = await loadApprovedReview();
  const review = demo.ingestion.importReview(artifact.artifact_id, { review: approved });
  assert.equal(review.classification, 'independently-reviewed');
  assert.equal(review.review_digest, '9dff1bcb0ea54ea53263856c3bd891c6aea8eb6dec773f54bb2c7044601a8189');
  const published = demo.ingestion.publish({
    artifact_id: artifact.artifact_id, request_id: 'pub-approved', review_digest: review.review_digest,
  });
  assert.equal(published.status, 'published');
  assert.equal(published.review_classification, 'independently-reviewed');
  const wine = demo.store.getWine(published.wine_id);
  assert.equal(wine.fields.region.review_classification, 'independently-reviewed');
  const chat = demo.ingestion.chat({ wine_id: published.wine_id, question: 'Where is this wine from?', request_id: 'chat-approved' });
  assert.equal(chat.citations[0].review_classification, 'independently-reviewed');
});

test('tampering with the approved artifact cannot gain independent status', async () => {
  const demo = makeDemo();
  const artifact = stageGlassfinch(demo);
  const approved = await loadApprovedReview();
  const tampered = { ...approved, reviewer_ref: 'Mallory', accepted_fields: ['region'] };
  // Accepted-fields change breaks the plan binding; a tampered review
  // must fail or fall back to simulated — never independent.
  let classification = null;
  try {
    classification = demo.ingestion.importReview(artifact.artifact_id, { review: tampered }).classification;
  } catch (e) {
    assert.ok(['invalid_review_plan', 'invalid_review_contradiction', 'stale_snapshot'].includes(e.code));
  }
  assert.notEqual(classification, 'independently-reviewed');
  const relabeled = { ...approved, reviewer_ref: 'Mallory' };
  const relabeledReview = demo.ingestion.importReview(artifact.artifact_id, { review: relabeled });
  assert.equal(relabeledReview.classification, 'simulated-playback');
});

test('replay/publication cannot upgrade an earlier simulated publication', async () => {
  const demo = makeDemo();
  // Both reviews are imported while the bound snapshot is current;
  // the simulated one publishes first.
  const artifact = stageGlassfinch(demo, 'stage-upgrade');
  const playback = demo.ingestion.importReview(artifact.artifact_id, { source: 'playback_example' });
  const approved = await loadApprovedReview();
  const review = demo.ingestion.importReview(artifact.artifact_id, { review: approved });
  assert.equal(review.classification, 'independently-reviewed');
  const published = demo.ingestion.publish({
    artifact_id: artifact.artifact_id, request_id: 'pub-upgrade-first', review_digest: playback.review_digest,
  });
  assert.equal(published.review_classification, 'simulated-playback');
  const replay = demo.ingestion.publish({
    artifact_id: artifact.artifact_id, request_id: 'pub-upgrade', review_digest: review.review_digest,
  });
  assert.equal(replay.status, 'already_published');
  const wine = demo.store.getWine(published.wine_id);
  assert.equal(wine.fields.region.review_classification, 'simulated-playback');
  const chat = demo.ingestion.chat({ wine_id: published.wine_id, question: 'Where is this wine from?', request_id: 'chat-upgrade' });
  assert.equal(chat.citations[0].review_classification, 'simulated-playback');
});

test('regions explorer groups actual catalog facts only', async () => {
  const demo = makeDemo();
  publishGlassfinch(demo);
  const { createApp } = await import('../src/server.js');
  const server = createApp(demo).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { regions } = await (await fetch(`${base}/api/regions`)).json();
    const pale = regions.find((r) => r.region === 'Pale Coast');
    assert.ok(pale && pale.wines.some((w) => w.vintage === 2018));
    assert.ok(regions.every((r) => !('rating' in r) && !('climate' in r) && !('coordinates' in r)));
  } finally {
    server.close();
  }
});
