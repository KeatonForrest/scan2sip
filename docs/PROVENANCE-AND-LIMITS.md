# Provenance and release limits

## Fixture provenance

Every fixture asset is listed in `fixtures/manifest.json` with SHA-256,
creator, creation method, synthetic status, rights basis, lineage, and
reviewer, and the server verifies the manifest at startup
(`src/fixtureIntegrity.js`). All producers, wines, labels, documents,
and model responses are fictional and authored for this demo; no real
producer names, logos, photography, copied prose, retailer data, or
production catalog exports are included. One file is externally
authored: the independently reviewed Glassfinch review artifact
(the independent reviewer, a separate AI reviewer referred to as “S”), copied byte-identical and pinned by canonical digest.

## Code provenance

`docs/SOURCE-INVENTORY.md` distinguishes behavioral adaptations of the
author's earlier private codebase (re-implemented here; that codebase
is not included or required) from modules written fresh for this demo.
No private data, captures, history, or planning documents are in this
repository.

## Release limits (current state)

- **Not yet a public release.** No `LICENSE` file exists for this
  project's own code; the license is decided at the final rights
  review. Dependency licenses and notice handling are inventoried in
  `docs/DEPENDENCIES.md`.
- **Fixture claims only.** Evaluation and tests demonstrate functional
  behavior against authored fixtures. They are not model-accuracy,
  provider-performance, latency, or search-quality evidence; provider
  latency is reported as N/A throughout.
- **Local only.** No hosting, accounts, crawling, PDF/OCR, vectors,
  live providers, or paid calls are implemented or implied.
- A public release requires, in order: final rights/license review,
  regeneration of the dependency inventory from the exact lock,
  fixture-manifest and screenshot/recording review of the exact
  package, and the owner's explicit publication approval.
