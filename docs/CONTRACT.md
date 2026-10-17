# scan2sip — scope and interface contract (milestone 1)

This is the public-safe contract for the fixture demo. It is a local,
no-credential, synthetic-fixture application. Anything not listed as in
scope is out of scope; scope does not grow silently — material interface
changes return to review before implementation.

## In scope (milestone 1)

- Local browser UI + loopback Express API + one SQLite file (`node:sqlite`).
- Fixture scan flow: fixture label → observed identity → match decision →
  attributed wine details.
- Fixture scenarios: correct match, vintage mismatch, duplicate catalog
  identity, unknown wine, uncertainty (provisional), missing fields, and
  three distinct simulated provider failures.
- Fixture manifest with per-asset provenance (`docs/FIXTURE-MANIFEST.md`).

## Later milestones (behind review checkpoints, not in milestone 1)

- Synthetic HTML document → quoted evidence → staging → review →
  deduplication → publication → retrieval update.
- Wine-specific chat bound to the exact published wine revision, with
  citations or an explicit insufficient-evidence answer.
- Clean-checkout evaluation run and a short recording.

## Out of scope (all milestones unless separately approved)

Paid calls; live provider implementation; crawling or URL fetching;
PDF/OCR; embeddings/vector search; hosting; accounts/auth; iOS extraction;
production data or credentials of any kind; automatic retries.

## Decision precedence (normative)

1. **Uncertainty outranks candidate existence.** An uncertain or incomplete
   observation (missing identity key, confidence outside `[0,1]`, or
   confidence below the demo's 0.6 provisional threshold) resolves to
   `provisional`. It can **never** resolve to an accepted catalog match
   merely because exactly one candidate exists.
2. **Missing vintage is never a year wildcard.** A `null` vintage matches
   only an explicitly `null`-vintage catalog identity. It is not
   non-vintage (NV) and never matches a year-specific record. A
   year-specific observation never matches a different year.
3. **Unmatched and uncertain scans create local research demand only.**
   They never publish catalog facts, never create shared catalog wines,
   and never supply wine-specific factual answers. Demand is deduplicated
   per canonical subject per UTC day and retains no photos or accounts.
4. **Field attribution is per field and never upgraded by matching.**
   Each displayed field is one of `reviewed synthetic source`,
   `AI-generated fixture`, `observed on label`, or `unknown`. An exact
   identity match does not turn an AI-generated fixture note into a
   producer-verified fact. Missing facts render as `unknown`, never
   silently filled.
5. **Confidence is a model signal, not a calibrated probability** of
   correctness. The 0.6 threshold is an inherited demo policy, labeled
   as such wherever it is surfaced.

## Replay, rescan, and failure semantics (normative)

- **Request replay is idempotent.** Re-sending the same scan `request_id`
  returns the original recorded result and creates no new observation,
  demand, or catalog change.
- **A deliberate rescan is a new observation** (new `request_id`) and may
  be recorded as history, but must not duplicate a catalog identity.
  Checks must distinguish: vintage mismatch ≠ duplicate catalog identity
  ≠ request replay.
- **Provider failures stay distinct and are never disguised:**
  - `provider_error_response` — a well-formed provider failure response;
  - `malformed_response` — a response that fails schema validation;
  - `provider_timeout_ambiguous` — a timeout whose outcome is unknown;
    the simulated attempt reservation is retained and the same request
    cannot be replayed as if it never happened.
  There is no automatic retry and no silent fallback to a successful
  fixture result.
- **Research-demand creation is the only side effect** of an unmatched or
  provisional scan, and only when a usable canonical identity key exists.

## Review semantics (ingestion milestone, recorded now)

- In-demo review is **playback**: illustrative rendering of a prepared
  review artifact. It must never be labeled or described as an actual
  independent review happening in the demo.
- A claim of independent acceptance requires a later, actual independent
  reviewer to inspect the source quotes and supply/approve the exact
  review artifact (bound to artifact hash, accepted fields, catalog
  snapshot, and expiry) outside the demo's playback path.

## Interfaces (milestone 1)

- `GET /api/fixtures` → `{ scenarios, manifest }` where `manifest`
  reports `{ verified, asset_count, assets: [{ id, path, sha256, kind,
  scenario }] }` for the integrity-verified fixture manifest.
- `POST /api/scans` `{ fixture_id, request_id }` → a flat result object
  `{ request_id, fixture_id, status, reason?, observation, wine_id?,
  demand_created, replayed?, reservation_retained? }` where `status` ∈
  `matched | missing | ambiguous | provisional | not_wine | failed`;
  `missing` carries `reason` ∈ `unknown_wine | vintage_mismatch |
  vintage_required`; `failed` carries `reason` ∈
  `provider_error_response | malformed_response |
  provider_timeout_ambiguous`. Reusing a `request_id` with a different
  `fixture_id` is rejected with HTTP 409 `{ error: "request_conflict" }`.
  At startup the server verifies every manifest entry's schema and
  SHA-256 and binds each scenario to its label asset and authored
  response; any mismatch fails startup with `fixture_integrity_failed`.
- `GET /api/wines/:id` — catalog wine with per-field attribution
  (`value`, `status`, `source_id`, `quote`/`locator` where applicable).
- `GET /api/demands` — deduplicated local research demand.
- `POST /api/reset` — reseed the disposable fixture workspace (local only).

## Milestone 2 — synthetic HTML ingestion, review, publication, chat (packet for review; not yet implemented)

One walkthrough: scan the unknown fictional Glassfinch Aurelia White 2018
→ open its synthetic producer sheet → stage quoted facts → review
accept/reject/hold per field → exact-identity deduplication → atomic
local publication + retrieval update → rescan matches → ask the wine a
question answered from its published revision with source quotes.

### Source evidence (actual local sheets, supplied with this packet)

- `fixtures/documents/orchard-lantern-hillside-red.html`,
  `coppermoth-ridge-pinot.html`, `sable-and-fern-meadow-white.html` —
  the real local sheets behind the existing seed `fixture://…-sheet`
  source labels; every seed quote in `fixtures/catalog.json` appears
  verbatim in its sheet.
- `fixtures/documents/glassfinch-aurelia-white.html` — the new ingestion
  example. `glassfinch-aurelia-white-undated.html` — the missing-vintage
  variant (no year stated, no explicit no-vintage statement).
- `fixtures/documents/proposals.json` — authored simulated extractor
  proposals. Glassfinch proposes region/varietal/producer_info with
  verbatim quotes, a food pairing whose supporting quote is **absent**
  (must be rejected), and no tasting note (stays unknown).

### Staging and review rules

- Staging validates each field's `supporting_text` verbatim against the
  document text and each identity quote likewise. Field-level support is
  computed (`supported` / `unsupported`); an unsupported field can never
  be accepted or published. **A present quote does not by itself prove
  the proposed value**: the reviewer must inspect entailment and reject
  unsupported or mismatched values. (Source-review observations recorded
  for this packet: Glassfinch region/varietal/producer-info entailments
  hold; the pairing proposal does not; the tasting note is absent.)
- **Missing-vintage ingestion is always held in v1** (`vintage_required`):
  no year is invented, and there is no no-vintage publication exception.
  (The pre-existing seed wine with an unknown vintage is seed behavior,
  not an ingestion outcome; unknown is never described as NV.) Identity
  evidence must support producer, bottling, and exact year **together**:
  the identity quotes collectively must contain the producer, the
  bottling name, and the vintage year — quoting any year somewhere is
  not sufficient.
- Review is per-field `accept | reject | hold`, bound to
  `artifact_sha256`, `catalog_snapshot_sha256`, accepted fields,
  `reviewer_ref` ≠ `curator_ref`/operator, `reviewed_at`, and
  `review_before`. Changed artifact, snapshot, or plan, or an expired
  review, refuses publication.
- **Playback vs. actual review:** the supplied
  `review-playback.example.json` is simulated playback, labeled as such
  in data and UI; local demo publication from playback is labeled
  “simulated review playback”. A caller-supplied `kind: "independent"`
  or a different `reviewer_ref` string is **not** independent approval:
  a review carries independently-reviewed status only when its exact
  digest matches an S-reviewed, hash-pinned artifact recorded in the
  demo configuration. Until S approves final bindings, every shipped
  or imported example remains simulated playback.
- **Deterministic review expiry:** fixture reviews use fixed fixture
  timestamps (reviewed 2026-10-01, `review_before` 2026-12-30) checked
  against a pinned workspace demo clock (shown in the UI as a fixture
  clock, never described as wall-clock time), so recordings and tests
  are reproducible. An expired-review case is demonstrated only by
  explicitly advancing the demo clock in a scenario, deterministically.

### Publication, deduplication, retrieval (atomic)

- Publication is one SQLite transaction: insert-or-dedupe the wine by
  canonical identity + exact vintage (unique, null-safe dedup key),
  write the immutable publication record under a unique `plan_digest`,
  and replace that wine's knowledge rows at the new revision. Partial
  publication is impossible; failures roll back and are surfaced, never
  swallowed (covered by a rollback test that forces retrieval-write
  failure).
- **Digests are stable and canonical** (SHA-256 over canonical JSON with
  sorted keys): `source_sha256` over the document bytes;
  `artifact_sha256` over `{ source_sha256, source_id, identity, fields }`;
  `catalog_snapshot_sha256` over the sorted catalog identities/fields/
  revisions; `plan_digest` over `{ artifact_sha256, accepted_fields
  (sorted), catalog_snapshot_sha256 }`. A review binds the exact plan
  and snapshot. **Replay precedes freshness checks:** a recorded
  publication is returned before any stale-snapshot validation, so a
  legitimate replay never fails because the catalog later changed.
- Re-importing the same document, or publishing an identity that
  already exists (e.g. the Orchard 2021 sheet), deduplicates to the
  existing wine — no second record, no silent field overwrite.
- Existing AI-generated fixture notes stay `AI-generated fixture`
  forever; publication never upgrades them. Unmatched/provisional scans
  still never publish.

### Proposed interfaces (milestone 2, for review)

- `POST /api/documents { document_id, request_id }` → staged artifact
  `{ artifact_id, artifact_sha256, identity, fields: [{ field, value,
  support, quotes }], status: staged | held, reason? }`. Same
  `request_id` + same document replays idempotently; same `request_id`
  with a different document is `409 request_conflict` (scan rules).
- `GET /api/artifacts/:id` — staged artifact with per-field support.
- `POST /api/artifacts/:id/review { review }` — imports a review
  artifact (playback or independently supplied), validates binding,
  snapshot, expiry (demo clock), and curator/reviewer separation.
- `POST /api/publications { artifact_id, request_id }` →
  `{ plan_digest, wine_id, revision, status: published |
  already_published }`; replay/conflict rules as for scans.
- `GET /api/wines/:id` gains `revision` and knowledge-backed fields.
- `POST /api/chat { wine_id, question, request_id }` →
  `{ wine_id, revision, answer, citations: [{ field, status,
  source_id, quote }], evidence_status: answered | unknown,
  mode: "fixture", provider_latency: "N/A" }`, composed
  deterministically from the exact wine revision's knowledge rows only.
  Supported questions map to published fields; absent evidence and
  unsupported questions answer with an explicit unknown template.
  Request replay binds `wine_id + revision + question`: same
  `request_id` with any of those changed is `409 request_conflict`.
  Authored fixture answers are labeled simulated everywhere; no live-AI
  impression, no general chat, no cross-wine facts, and a changed
  selection can never display another wine's answer.
- Store additions: `artifacts`, `reviews`, `publications`,
  `knowledge_rows (wine_id, revision, field, value, source_id, quote)`
  with unique `(identity_key, vintage)`, unique `plan_digest`, and
  unique `(wine_id, revision, field)` constraints.
- UI: one “Evidence flow” panel (document → staged quotes → review
  decisions → publication result) and an “Ask this wine” panel on the
  matched-wine outcome. No dashboard/auth/framework additions; the
  polished scan flow is unchanged.

## Runtime

- Node **24.22.0** is the pinned, tested runtime (`.nvmrc`,
  `package.json` engines `>=24 <25`). Developed/tested with a Node
  24.22.0 binary kept outside any other project's checkout; no other
  project's Node version or dependencies are altered.
- Fixture checks must pass with no credentials and outbound networking
  denied (after `npm ci`).
