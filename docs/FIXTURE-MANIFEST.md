# Fixture manifest schema

Every fixture asset (label artwork, catalog data, model responses, later:
synthetic documents and review artifacts) has one entry in
`fixtures/manifest.json`. No asset ships without an entry.

## Entry fields

| Field | Meaning |
|---|---|
| `id` | Stable fixture identifier used by the API and checks. |
| `path` | Repository-relative path of the asset. |
| `sha256` | SHA-256 of the file bytes at manifest-writing time. |
| `kind` | `label-image` \| `catalog` \| `model-response` \| `scenario-index` \| `document` \| `review-artifact`. |
| `creator` | Who created the asset (person/tool). |
| `creation_method` | How it was made (e.g. "hand-authored SVG", "authored JSON"). |
| `synthetic` | Always `true` in this repository. |
| `rights_basis` | Why redistribution is permitted (e.g. "original work created for this demo"). |
| `source_lineage` | Where the content came from; `original` for all current fixtures. |
| `modifications` | Any changes from its source, or `none`. |
| `scenario` | The check/scenario this asset exercises. |
| `reviewer` | Who reviewed the asset for fictional/provenance correctness. |

## Rules

- Fictional producers and wines only. No real producer names, logos,
  bottle photography, copied prose, retailer records, or production
  catalog exports.
- Model responses are authored deterministic fixtures, not provider
  recordings, and are never presented as model-accuracy evidence.
- Fixture mode accepts only manifest-listed fixture hashes for replay;
  there is no arbitrary-upload path in fixture mode.
- Assets with unclear rights are excluded or replaced, never shipped
  on assumption.
