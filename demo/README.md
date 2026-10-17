# Walkthrough recording

[`scan2sip-walkthrough.mp4`](scan2sip-walkthrough.mp4) ·
[`preview.png`](preview.png) (an actual decoded frame) ·
[`recording-chapters.json`](recording-chapters.json) (source metadata)

## Provenance

- **Runtime recorded:** `5ed7a7a944ed4686d607a960ffb5aad88387e53c`
  (the accepted milestone-2 revision; the later docs/eval commit did
  not change runtime behavior).
- **Capture:** actual Chrome viewport of the running demo, scripted UI
  interactions at real elapsed timestamps, captions added for the
  recording; H.264, 1280×900, 64.76 s, no audio, ~2 MB. Provider
  calls: 0; provider latency: N/A. The timings show a person-paced
  walkthrough, not provider or system performance.
- **Hashes (SHA-256):**
  - `scan2sip-walkthrough.mp4` — `38ae6cd000afd6f4d98ec5ef2c1709a55fc2d8d90294d42d6640e07bf99d6815`
  - `preview.png` — `f283593d9440c6fa3ee2ca52f4a9c15c684dcad9607b51f4a5ea86edc1fc7d8e`
- **Wording note:** reviewer-label wording in the current UI/docs was
  clarified after recording (the button now reads “independently
  reviewed” and the reviewer is explained in prose). Behavior and
  fixtures are unchanged; the recording is honest historical metadata
  for the revision above.
- **What it shows:** synthetic fixture output end to end. The
  independently reviewed artifact in the flow was reviewed by a
  separate AI reviewer (referred to as “S” in project records), who
  checked the **synthetic source and its exact bindings** — that is
  not human or producer verification of any real wine, and nothing in
  the recording is a real product claim.

## Transcript (chapter titles, from `recording-chapters.json`)

| At | Chapter |
|---:|---|
| 0.0s | From a bottle to an answer you can inspect. |
| 4.1s | An exact match keeps each fact's source status. |
| 9.1s | A different vintage is a different wine. No silent substitution. |
| 14.2s | A blurred identity stays uncertain—even when a similar wine exists. |
| 19.2s | Glassfinch is unknown. A scan creates research demand, not catalog facts. |
| 24.3s | Stage an original synthetic source: inspect quotes; reject unsupported pairing. |
| 31.4s | Load the exact independently reviewed artifact. This is synthetic-source review. |
| 37.4s | Publish once: the catalog and retrieval knowledge update together. |
| 42.5s | Rescan the same bottle. It now matches the reviewed knowledge. |
| 47.6s | Ask this wine: Albariño, with a quote and the stored review classification. |
| 53.7s | No accepted pairing evidence? The answer stays unknown. |
| 58.7s | Explore fictional regions and vintages using the same attributed catalog. |
