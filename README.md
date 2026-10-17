# scan2sip (fixture demo)

A runnable **local, no-credential, synthetic-fixture** demonstration of a
scan-to-knowledge flow:

bottle label → observed identity → exact match or visible uncertainty →
per-field attributed details → (later milestone) wine-specific chat, plus a
synthetic document → quoted evidence → staging → review → publication →
retrieval path.

Everything in this repository is fictional: fictional producers, wines, label
artwork and model responses. Fixture mode never calls a provider, never needs
credentials, and must pass its checks with outbound networking denied after
dependency installation. Simulated provider output is labeled as such, and
provider latency is always reported as **N/A** in fixture mode.

## Status

Milestone 1: skeleton + fixture scan/matching/uncertainty.
Ingestion, review/publication and chat are later milestones behind review
checkpoints; they are described in `docs/CONTRACT.md` but not implemented yet.

## Decisions and defaults (all reversible)

- Runtime: **Node 24** (pinned, supported LTS line; see `docs/CONTRACT.md`
  for the exact tested version). This demo does not change any other
  project's runtime requirements.
- Server: Express; UI: small vanilla browser interface; store: one local
  SQLite file via the built-in `node:sqlite` module (no database service,
  no native npm build). If that API proves unsuitable on a target platform,
  the fallback is a single pinned SQLite driver chosen before any second
  storage implementation is written.
- License: **not yet committed.** No `LICENSE` file exists until a rights
  review of code and fixtures is completed. Do not assume a license from
  this repository's presence.

## Run (milestone 1)

```bash
npm ci            # or: npm install
npm test          # offline fixture checks (Node 24)
npm start         # local demo at http://127.0.0.1:4173
```

## Boundaries

No paid calls, no live provider implementation, no crawling, no PDF/OCR,
no vector search, no hosting, no production data, no customer data, no
secrets. See `docs/CONTRACT.md` for the full scope contract and
`docs/SOURCE-INVENTORY.md` for provenance of adapted logic.
