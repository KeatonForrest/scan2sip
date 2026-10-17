// Milestone 2: synthetic HTML ingestion -> staging -> review ->
// publication/retrieval -> wine chat. All deterministic fixture logic;
// no provider, no crawling (local manifest-bound documents only).

import fs from 'node:fs';
import path from 'node:path';
import { digest, sha256Bytes } from './core/digest.js';
import { identityMatchKey } from './core/identity.js';

export const DEMO_CLOCK_START = '2026-10-17T00:00:00.000Z';
const KNOWN_FIELDS = ['region', 'type', 'varietal', 'tasting_notes', 'producer_info', 'food_pairings'];
// Order matters: varietal is checked before region so "What grape is
// it made from?" resolves to the grape, not the trailing "from".
const FIELD_QUESTIONS = [
  ['varietal', /\b(varietal|variety|grape|made from)\b/i],
  ['region', /\b(region|where|grown)\b/i],
  ['tasting_notes', /\b(tasting|note|taste|flavor|flavour)\b/i],
  ['food_pairings', /\b(pair|food|eat|serve with)\b/i],
  ['producer_info', /\b(producer|winery|who (made|makes)|estate)\b/i],
  ['type', /\b(type|style|red|white)\b/i],
];

function err(code, status = 422) {
  return Object.assign(new Error(code), { code, status });
}

export function dedupKeyFor(identity) {
  const key = identityMatchKey(identity?.producer, identity?.name);
  if (!key) return null;
  return `${key.producer}::${key.name}::${identity.vintage ?? 'unknown'}`;
}

export function catalogSnapshotDigest(wines) {
  return digest(wines
    .map((w) => ({ dedup_key: w.dedup_key, revision: w.revision, fields: w.fields }))
    .sort((a, b) => String(a.dedup_key).localeCompare(String(b.dedup_key))));
}

function documentText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createIngestion({
  store,
  proposalsDoc,
  fixturesRoot,
  demoClock = DEMO_CLOCK_START,
  pinnedIndependentReviewDigest = null,
}) {
  let clock = demoClock;
  const proposals = proposalsDoc.proposals;

  function documents() {
    return Object.entries(proposals).map(([document_id, p]) => ({
      document_id,
      document: p.document,
      identity: p.identity,
      source_id: p.source_id,
    }));
  }

  function stage({ document_id, request_id }) {
    if (!document_id || !request_id) throw err('invalid_request', 400);
    const prior = store.getBoundRequest('stage_requests', request_id);
    if (prior) {
      if (prior.document_id !== document_id) throw err('request_conflict', 409);
      return { ...JSON.parse(prior.result), replayed: true };
    }
    const proposal = proposals[document_id];
    if (!proposal) throw err('unknown_document', 404);

    const filePath = path.join(fixturesRoot, proposal.document);
    const bytes = fs.readFileSync(filePath);
    const source_sha256 = sha256Bytes(bytes);
    const text = documentText(bytes.toString('utf8'));
    const { identity } = proposal;

    const identityQuotes = (proposal.identity_quotes ?? []).map((q) => ({
      quote: q, present: text.includes(q),
    }));
    const joinedQuotes = identityQuotes.filter((q) => q.present).map((q) => q.quote).join(' ');
    const identitySupported = identityQuotes.every((q) => q.present)
      && joinedQuotes.includes(identity.producer)
      && joinedQuotes.includes(identity.name)
      && (identity.vintage === null || joinedQuotes.includes(String(identity.vintage)));

    const fields = Object.entries(proposal.fields ?? {}).map(([field, f]) => {
      if (f.value == null) return { field, value: null, support: 'absent', quotes: [] };
      const quotes = (f.supporting_text ?? []).map((q) => ({ quote: q, present: text.includes(q) }));
      return {
        field, value: f.value, locator: f.locator ?? null,
        support: quotes.length > 0 && quotes.every((q) => q.present) ? 'supported' : 'unsupported',
        quotes,
      };
    });

    let status = 'staged';
    let reason;
    if (identity.vintage === null || identity.vintage === undefined) {
      status = 'held'; reason = 'vintage_required';
    } else if (!identitySupported) {
      status = 'held'; reason = 'invalid_identity_evidence';
    }

    const artifact_sha256 = digest({
      source_sha256, source_id: proposal.source_id, identity,
      fields: Object.fromEntries(fields.map((f) => [f.field, { value: f.value, quotes: f.quotes.map((q) => q.quote) }])),
    });
    const artifact = {
      artifact_id: `art-${artifact_sha256.slice(0, 12)}`,
      artifact_sha256, source_sha256, source_id: proposal.source_id,
      document_id, identity, identity_quotes: identityQuotes, fields,
      status, ...(reason ? { reason } : {}),
      curator_ref: 'demo-operator',
    };
    store.saveArtifact(artifact);
    const result = { ...artifact, replayed: false };
    store.recordBoundRequest('stage_requests', request_id, document_id, result);
    return result;
  }

  function buildReview(artifact, input) {
    if (input?.source === 'playback_example') {
      const accepted = artifact.fields
        .filter((f) => f.support === 'supported')
        .map((f) => f.field);
      const decisions = Object.fromEntries(artifact.fields.map((f) => [
        f.field, f.support === 'supported' ? 'accept' : (f.support === 'absent' ? 'hold' : 'reject'),
      ]));
      return {
        schema: 'scan2sip-review-v1', kind: 'playback',
        reviewer_ref: 'playback-reviewer (simulated)', curator_ref: artifact.curator_ref,
        reviewed_at: '2026-10-01T00:00:00.000Z', review_before: '2026-12-30T00:00:00.000Z',
        decisions, accepted_fields: accepted,
      };
    }
    return input?.review ?? input;
  }

  function importReview(artifactId, input) {
    const artifact = store.getArtifact(artifactId);
    if (!artifact) throw err('artifact_not_found', 404);
    if (artifact.status === 'held') throw err('artifact_held');
    const isPlaybackBuilder = input?.source === 'playback_example';
    const review = buildReview(artifact, input ?? {});
    if (!review || typeof review !== 'object') throw err('invalid_review');
    if (!isPlaybackBuilder) {
      // An explicit review must arrive bound. Only the clearly labeled
      // playback builder may have its demo bindings filled in here;
      // supplied bindings are verified, never silently overwritten.
      if (review.artifact_sha256 !== artifact.artifact_sha256) throw err('invalid_review_binding');
      if (!review.catalog_snapshot_sha256 || !review.plan_digest) throw err('invalid_review_unbound');
    }
    // decisions and accepted_fields, when both supplied, must agree.
    let accepted;
    if (review.decisions != null) {
      if (typeof review.decisions !== 'object' || Array.isArray(review.decisions)) throw err('invalid_review');
      const fromDecisions = Object.entries(review.decisions)
        .filter(([, d]) => d === 'accept').map(([f]) => f);
      if (review.accepted_fields != null) {
        const a = [...review.accepted_fields].sort();
        const b = [...fromDecisions].sort();
        if (JSON.stringify(a) !== JSON.stringify(b)) throw err('invalid_review_contradiction');
      }
      accepted = fromDecisions;
    } else {
      accepted = review.accepted_fields;
    }
    const supported = new Set(artifact.fields.filter((f) => f.support === 'supported').map((f) => f.field));
    if (!Array.isArray(accepted) || accepted.length === 0) throw err('invalid_review');
    if (accepted.some((f) => !supported.has(f))) throw err('invalid_review_unsupported_accept');
    if (!review.reviewer_ref || review.reviewer_ref === (review.curator_ref ?? artifact.curator_ref)) {
      throw err('invalid_review_separation');
    }
    const snapshot = catalogSnapshotDigest(store.listWines());
    if (review.catalog_snapshot_sha256 && review.catalog_snapshot_sha256 !== snapshot) {
      throw err('stale_snapshot', 409);
    }
    const plan_digest = digest({
      artifact_sha256: artifact.artifact_sha256,
      accepted_fields: [...accepted].sort(),
      catalog_snapshot_sha256: snapshot,
    });
    if (review.plan_digest && review.plan_digest !== plan_digest) throw err('invalid_review_plan');
    if (!(Date.parse(review.reviewed_at) <= Date.parse(clock) && Date.parse(clock) < Date.parse(review.review_before))) {
      throw err('expired_review');
    }
    const bound = {
      ...review,
      artifact_sha256: artifact.artifact_sha256,
      catalog_snapshot_sha256: snapshot,
      plan_digest,
      accepted_fields: [...accepted].sort(),
    };
    const review_digest = digest(bound);
    // Independently-reviewed status exists only for an exact S-reviewed,
    // hash-pinned artifact. A caller's kind/reviewer_ref never suffices.
    const classification = review.kind === 'independent' && pinnedIndependentReviewDigest
      && review_digest === pinnedIndependentReviewDigest
      ? 'independently-reviewed' : 'simulated-playback';
    const saved = { ...bound, review_digest, classification };
    store.saveReview(saved);
    return saved;
  }

  function publish({ artifact_id, request_id, review_digest }) {
    if (!artifact_id || !request_id) throw err('invalid_request', 400);
    const prior = store.getBoundRequest('publication_requests', request_id);
    if (prior) {
      if (prior.artifact_id !== artifact_id) throw err('request_conflict', 409);
      return { ...JSON.parse(prior.result), replayed: true };
    }
    const artifact = store.getArtifact(artifact_id);
    if (!artifact) throw err('artifact_not_found', 404);
    if (artifact.status === 'held') throw err('artifact_held');
    // Select a review unambiguously: an exact digest, or the single
    // imported review. Multiple imports without a digest are ambiguous.
    let review;
    if (review_digest) {
      review = store.getReviewByDigest(review_digest);
      if (!review || review.artifact_sha256 !== artifact.artifact_sha256) throw err('review_not_found', 404);
    } else {
      const reviews = store.getReviews(artifact.artifact_sha256);
      if (reviews.length === 0) throw err('review_required');
      if (reviews.length > 1) throw err('ambiguous_review', 409);
      [review] = reviews;
    }

    // Replay precedes freshness: a recorded publication is returned
    // before any stale-snapshot validation.
    const recorded = store.getPublicationByPlan(review.plan_digest)
      ?? store.getPublicationByArtifact(artifact.artifact_sha256);
    if (recorded) {
      const result = {
        status: 'already_published', plan_digest: recorded.plan_digest,
        wine_id: recorded.wine_id, revision: recorded.revision, changed: false,
      };
      store.recordBoundRequest('publication_requests', request_id, artifact_id, result);
      return result;
    }

    if (!(Date.parse(clock) < Date.parse(review.review_before))) throw err('expired_review');
    const snapshot = catalogSnapshotDigest(store.listWines());
    if (snapshot !== review.catalog_snapshot_sha256) throw err('stale_snapshot', 409);

    const dedup_key = dedupKeyFor(artifact.identity);
    if (!dedup_key) throw err('invalid_identity_evidence');
    const acceptedFields = artifact.fields.filter((f) => review.accepted_fields.includes(f.field));

    const result = store.transaction(() => {
      const existing = store.getWineByDedupKey(dedup_key);
      if (existing) {
        // Duplicate identity: no field changes, no provenance upgrades.
        store.recordPublication({
          plan_digest: review.plan_digest, artifact_sha256: artifact.artifact_sha256,
          wine_id: existing.id, revision: existing.revision, status: 'already_published', changed: false,
        });
        return {
          status: 'already_published', plan_digest: review.plan_digest,
          wine_id: existing.id, revision: existing.revision, changed: false,
        };
      }
      const wine_id = `wine-${dedup_key.replace(/[^a-z0-9]+/g, '-')}`;
      const fields = {};
      for (const field of KNOWN_FIELDS) {
        const acceptedField = acceptedFields.find((f) => f.field === field);
        fields[field] = acceptedField
          ? {
            value: acceptedField.value, status: 'reviewed synthetic source',
            // The review classification travels with every published
            // field: simulated playback can never render as
            // independently reviewed evidence.
            review_classification: review.classification,
            source_id: artifact.source_id, quote: acceptedField.quotes.find((q) => q.present)?.quote ?? null,
          }
          : { value: null, status: 'unknown', source_id: null, quote: null };
      }
      store.insertWine({
        id: wine_id, producer: artifact.identity.producer, name: artifact.identity.name,
        vintage: artifact.identity.vintage, dedup_key, revision: 1,
        identification_aliases: [], fields,
      });
      store.replaceKnowledge(wine_id, 1, acceptedFields.map((f) => ({
        field: f.field, value: Array.isArray(f.value) ? f.value.join(', ') : f.value,
        source_id: artifact.source_id, quote: f.quotes.find((q) => q.present)?.quote ?? null,
        classification: review.classification,
      })))
      store.recordPublication({
        plan_digest: review.plan_digest, artifact_sha256: artifact.artifact_sha256,
        wine_id, revision: 1, status: 'published', changed: true,
      });
      return {
        status: 'published', plan_digest: review.plan_digest, wine_id, revision: 1,
        changed: true, review_classification: review.classification,
      };
    });
    store.recordBoundRequest('publication_requests', request_id, artifact_id, result);
    return result;
  }

  function chat({ wine_id, question, request_id }) {
    if (!wine_id || typeof question !== 'string' || !question.trim() || !request_id) {
      throw err('invalid_request', 400);
    }
    const wine = store.getWine(wine_id);
    if (!wine) throw err('wine_not_found', 404);
    const binding_digest = digest({ wine_id, revision: wine.revision, question: question.trim().toLowerCase() });
    const prior = store.getBoundRequest('chat_requests', request_id);
    if (prior) {
      if (prior.binding_digest !== binding_digest) throw err('request_conflict', 409);
      return { ...JSON.parse(prior.result), replayed: true };
    }
    const match = FIELD_QUESTIONS.find(([, re]) => re.test(question));
    const field = match?.[0];
    const knowledge = store.getKnowledge(wine_id, wine.revision);
    const row = field ? knowledge.find((k) => k.field === field) : null;
    const vintageLabel = wine.vintage ?? 'vintage unknown';
    let result;
    if (row && row.value != null) {
      const attribution = wine.fields[field];
      result = {
        wine_id, revision: wine.revision,
        answer: `${field}: ${row.value}`,
        citations: [{
          field, status: attribution?.status ?? 'reviewed synthetic source',
          review_classification: row.classification ?? attribution?.review_classification ?? null,
          source_id: row.source_id, quote: row.quote,
        }],
        evidence_status: 'answered', mode: 'fixture', provider_latency: 'N/A',
      };
    } else {
      result = {
        wine_id, revision: wine.revision,
        answer: `Unknown — this fixture has no published evidence${field ? ` for ${field}` : ' for that question'} on ${wine.producer} ${wine.name} (${vintageLabel}). (Simulated fixture answer.)`,
        citations: [], evidence_status: 'unknown', mode: 'fixture', provider_latency: 'N/A',
      };
    }
    store.recordBoundRequest('chat_requests', request_id, binding_digest, result);
    return result;
  }

  return {
    documents, stage, importReview, publish, chat,
    getDemoClock: () => clock,
    setDemoClock: (next) => { clock = next; return clock; },
    snapshot: () => catalogSnapshotDigest(store.listWines()),
  };
}
