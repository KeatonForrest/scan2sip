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

- `GET /api/fixtures` — fixture scenarios and their manifest entries.
- `POST /api/scans` `{ fixture_id, request_id }` →
  `{ request_id, observation, decision, wine?, demand_created }` where
  `decision.status` ∈ `matched | missing | ambiguous | provisional |
  not_wine | failed`; `missing` carries `reason` ∈ `unknown_wine |
  vintage_mismatch | vintage_required`; `failed` carries `reason` ∈
  `provider_error_response | malformed_response |
  provider_timeout_ambiguous`.
- `GET /api/wines/:id` — catalog wine with per-field attribution
  (`value`, `status`, `source_id`, `quote`/`locator` where applicable).
- `GET /api/demands` — deduplicated local research demand.
- `POST /api/reset` — reseed the disposable fixture workspace (local only).

## Runtime

- Node **24** pinned for development and checks; the exact tested patch
  version is recorded in the milestone report and `package.json` engines.
  Developed/tested with a Node 24 binary kept outside any other project's
  checkout; no other project's Node version or dependencies are altered.
- Fixture checks must pass with no credentials and outbound networking
  denied (after `npm ci`).
