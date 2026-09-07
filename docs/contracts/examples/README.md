# Contract examples

Valid and invalid JSON fixtures for the Lot -1 ajv corpus. CI fails if a valid
file is rejected or an invalid file is accepted.

| Directory | Expectation |
| --- | --- |
| `valid/` | Must validate against the schema inferred from the filename prefix |
| `invalid/` | Must **not** validate |

Filename prefixes: `raw-event.`, `refined-step.`, `health.` matching
`docs/contracts/schemas/*.schema.json`.
