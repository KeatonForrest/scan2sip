# Copied / adapted source inventory

This demo is a fresh, standalone implementation. No files, tests, data,
fixtures, or history were copied from any other repository. The items
below are **behavioral adaptations**: small pure-logic rules re-implemented
here after inspecting the author's earlier private codebase (Tannin,
inspected at commit `1f4849b73881195194321820b3d712649865a3e3`). That
codebase is not included, linked, or required at build or run time, and
final licensing of this demo is deferred until a rights review — this
inventory is the provenance record for that review.

| Demo module | Adapted behavior | Origin (author's private codebase) |
|---|---|---|
| `src/core/identity.js` | Canonical identity key: Unicode mark-stripping, punctuation folding, `&`→`and`, whitespace collapse, 200-byte part limit; null when either part is empty | `backend/src/services/identityMatchKey.js` (`matchKeyPart`, `identityMatchKey`) |
| `src/core/observation.js` | Identity projection (4-digit vintage bounded 1800…current year+1, else `null`); provisional predicate (missing key, or confidence non-finite / < 0.6 / > 1) | `backend/src/services/scanModel.js` (`projectExtractedIdentity`), `backend/src/services/scanCatalogAdmission.js` (`projectedObservation`, `needsProvisionalAdmission`), `backend/src/services/confidenceThreshold.js` (0.6) |
| `src/core/matching.js` | Exact-match precedence over raw/canonical/alias keys with exact vintage equality; `null` vintage matches only `null`; multiple exact candidates are ambiguous, never first-wins | `backend/src/services/scanCatalogAdmission.js` (`resolveScanIdentity`) semantics, re-implemented synchronously over the local store |
| `src/core/demand.js` | Research-demand idea: canonical subject + original UTC day deduplication, no photos/accounts retained | `backend/src/services/scanResearchDemand.js` concept only; local table designed here |
| (milestone 2, packet stage) evidence/publication/chat | Verbatim-quote evidence validation, digest-bound review/publication semantics, and field-attributed knowledge content are proposed adaptations; inventoried in full when implemented. The milestone-2 evidence packet (synthetic source sheets + authored proposals) lives in `fixtures/documents/` | `producerFieldEvidence.js`, `dailyProducerPublication.js`, `dailyProducerKnowledge.js`, `chatPrompts.js` (planned) |

Explicitly **not** adapted or copied: production configuration, provider
SDK calls, retry helpers, database models/schemas, capture archives,
catalog data, evaluation datasets, and any private planning documents.
