# Workflow example spreadsheets (synthetic)

| File | Use with | What it exercises |
| --- | --- | --- |
| `gl_export_messy.csv` | GL expense cleaner, CAM expense classification | Mixed date formats, `$` and `(credit)` amounts, `6110.0` codes, an exact duplicate, a blank description, a bad date, a 3-decimal amount, a blank account, a formula-injection cell |
| `gl_export_march.csv` | GL expense cleaner (rerun) | A clean second file for rerunning a saved workflow |
| `tenant_roster.csv` | Lease rule completeness audit | One tenant with no rule, one rule that does not exist |
| `tenant_billings.csv` | Tenant billing comparison | Mesquite Crossing billings keyed by tenant name |

All names, amounts and leases are fictional.
