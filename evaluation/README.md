# Evaluation and release-review receipt

Two different things are measured in this repository, and they are not
interchangeable:

| Check | Command | What it is |
|---|---|---|
| Deterministic evaluator | `npm run eval` / `npm run eval:check` | **14 fixed fixture cases** in `evaluation/evaluate.mjs`, exercising the actual HTTP API against authored fixtures; committed output in `evaluation/results.json`, tied to the fixture-manifest SHA-256. `--check` recomputes and requires byte-identical reproduction. |
| Automated test suite | `npm test` | **44 automated tests** at the finishing-pass checkpoint: service/API/integrity tests plus browser regressions that drive the installed system Chrome over CDP. |

## The 14 evaluator cases

Correct match · vintage mismatch · request replay · duplicate rescan ·
unknown wine · uncertainty (provisional) · missing vintage · missing
fields/AI-only notes · three distinct simulated provider failures ·
unsupported/held evidence · approved independent-review binding ·
atomic publication + retrieval + exact-wine chat · duplicate
publication · rescan after publication.

They demonstrate functional fixture behavior only. They are **not**
model-accuracy, provider-performance, or latency evidence; provider
output is simulated and provider latency is reported as N/A.

## The 44 tests, honestly scoped

- Node tests cover identity/matching semantics, replay/conflict rules,
  fixture-manifest integrity (tamper/omission/duplicate detection),
  staging/review/publication/chat, transaction rollback, and HTTP
  shapes.
- Browser tests cover the correlated UI state (stale-wine, replay
  binding, reset races, failed-reset preservation) and the full
  evidence→publish→rescan→chat→explorer journey.
- **Chrome requirement:** browser tests need a system Chrome/Chromium
  (or `CHROME_BIN`); where none exists they **skip with a reason**
  instead of failing, so a test count from a Chrome-less environment
  can legitimately show skips and a lower executed total.

## Verification scope

- Verified from a fresh clone: `npm ci`, then `npm run eval:check`
  reproduces the committed results byte-identically, and regenerating
  `docs/DEPENDENCIES.md` from the exact lock reproduces it
  byte-identically (65 packages).
- “Offline” claims mean: after `npm ci`, the evaluator and tests make
  no external network calls (loopback only). Dependency installation
  itself uses the npm registry.
- Nothing here is a security audit or a guarantee about third-party
  packages; dependency notices are inventoried in
  `docs/DEPENDENCIES.md`.

## Recording note

The walkthrough in `demo/` was recorded from the exact accepted
runtime revision. Cosmetic reviewer-label wording in the UI and docs
was clarified afterward (“independently reviewed”, with the reviewer
explained in prose); behavior, fixtures, and results are unchanged,
so the recording remains honest historical metadata and no re-record
is needed.
