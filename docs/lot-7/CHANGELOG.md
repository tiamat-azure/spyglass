# Lot 7 changelog (v1.1)

- Assisted patch apply (F-62–F-65, ADR-0008): `health.json` candidates,
  `PATCH_ASSISTED_APPLY` (default false), dedicated git branch + draft PR
  against `--repo`. Verification/structure stay proposal-only (CA-14).
- Optional STT precision upgrade (F-38, F-39, ADR-0017): contextual
  `large-v3-turbo` proposal after N transcript edits; `small` remains the
  fallback.
- Session export/import of an autonomous folder (F-47).
- In-app pas-à-pas replay with Suivant / Arrêter and chat follow (F-59).
- Scenario parameterization: fill/select values become `--dataset`
  variables; distinct datasets replay the same scenario (F-48).
