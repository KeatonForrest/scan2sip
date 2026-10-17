# Copied / adapted source inventory

This demo is a fresh, standalone implementation. No files, tests, data,
fixtures, or history were copied from any other repository. Two kinds of
provenance are distinguished below:

- **Behavioral adaptations** — small pure-logic rules re-implemented
  here after inspecting the author's earlier private codebase (Tannin,
  inspected at commit `1f4849b73881195194321820b3d712649865a3e3`).
- **Fresh implementations** — modules designed and written for this
  demo with no counterpart copied or adapted.

That private codebase is not included, linked, or required at build or
run time. This demo is released under the MIT License (see `LICENSE`);
this inventory is the provenance record behind that release.

## Behavioral adaptations

| Demo module | Adapted behavior | Origin (author's private codebase) |
|---|---|---|
| `src/core/identity.js` | Canonical identity key: Unicode mark-stripping, punctuation folding, `&`→`and`, whitespace collapse, 200-byte part limit; null when either part is empty | `backend/src/services/identityMatchKey.js` (`matchKeyPart`, `identityMatchKey`) |
| `src/core/observation.js` | Identity projection (4-digit vintage bounded 1800…current year+1, else `null`); provisional predicate (missing key, or confidence non-finite / < 0.6 / > 1) | `backend/src/services/scanModel.js` (`projectExtractedIdentity`), `backend/src/services/scanCatalogAdmission.js` (`projectedObservation`, `needsProvisionalAdmission`), `backend/src/services/confidenceThreshold.js` (0.6) |
| `src/core/matching.js` | Exact-match precedence over raw/canonical/alias keys with exact vintage equality; `null` vintage matches only `null`; multiple exact candidates are ambiguous, never first-wins | `backend/src/services/scanCatalogAdmission.js` (`resolveScanIdentity`) semantics, re-implemented synchronously over the local store |
| `src/service.js` (demand recording) + `src/store.js` (`demands` table) | Research-demand idea: canonical subject + original UTC day deduplication, no photos/accounts retained | `backend/src/services/scanResearchDemand.js` concept only; local design here |
| `src/ingestion.js` (staging/review/publication) | Verbatim-quote evidence validation; digest-bound review with curator/reviewer separation and expiry; compare-and-publish with deduplication and no silent overwrite | Semantics adapted from `producerFieldEvidence.js` and `dailyProducerPublication.js`; re-implemented over the local store and canonical digests |
| `src/ingestion.js` (chat) + `knowledge_rows` | Field-attributed knowledge content and wine-scoped, citation-carrying answers with explicit unknowns | Prompt/attribution semantics adapted from `dailyProducerKnowledge.js` and `chatPrompts.js`; deterministic fixture composer written here |

## Fresh implementations (no adapted origin)

| Demo module | Purpose |
|---|---|
| `src/core/digest.js` | Canonical-JSON SHA-256 digests (source/artifact/snapshot/plan/review/chat bindings) |
| `src/store.js` | Local SQLite store (`node:sqlite`): wines, observations, requests, demands, artifacts, reviews, publications, knowledge rows, transactions |
| `src/fixtureIntegrity.js` | Manifest schema/SHA-256 verification and scenario/document binding; fail-closed startup |
| `src/adapters/fixtureModel.js` | Hash-keyed authored fixture responses with distinct simulated failure modes |
| `src/ingestion.js` (orchestration) | Document staging, review import/classification (incl. the server-side pinned independent review), atomic publication, chat replay binding |
| `src/server.js`, `web/` | Loopback Express API and the vanilla browser UI (scan, evidence flow, ask-this-wine, region explorer) |

Explicitly **not** adapted or copied: production configuration, provider
SDK calls, retry helpers, database models/schemas, capture archives,
catalog data, evaluation datasets, and any private planning documents.
The one externally authored file in the tree is the independently
reviewed Glassfinch artifact
(`fixtures/documents/approved-glassfinch-review.json`, by the independent reviewer “S”, a separate AI reviewer), copied
byte-identical from the reviewer's public-safe export and recorded in
the fixture manifest.
