# Security review, v0.2

Date: 2026-11-03. Scope: backend API, frontend, data handling, dependencies. This is a code review with automated tests, not a penetration test. Veyra is **not** production-secure yet; see "Open items".

## Verified controls

| Area | Control | Evidence |
| --- | --- | --- |
| Passwords | argon2id hashes (`argon2-cffi` defaults) | `app/auth.py` |
| Sessions | Signed token (itsdangerous) with 8 h max age, httpOnly, SameSite=Lax, Secure when configured; carries `session_version` | `test_logout_revokes_session` |
| Logout | Increments `session_version`, revoking every token for the user | same |
| Brute force | 5 failed logins per email and 50 per IP per 15 min, then 429 with `Retry-After` | `test_login_is_rate_limited` |
| Organization isolation | Every read through `get_owned` or `scoped`; foreign rows return 404, indistinguishable from missing | `test_org_isolation`, `test_org_isolation_across_all_resources` (13 endpoints) |
| SQL injection | SQLAlchemy expressions only; `ilike` search uses bound parameters | code review |
| XSS | React escapes output; no `dangerouslySetInnerHTML`; API responses carry `Content-Security-Policy: default-src 'none'` | code review |
| CSRF | SameSite=Lax cookie; state-changing requests are JSON or multipart from the same origin via the Next.js proxy; CORS limited to configured origins, methods and headers | `app/main.py` |
| Uploads | `.csv`/`.xlsx` only, XLSX magic bytes, UTF-8 CSV, NUL-byte check, 10 MB limit, filename sanitized, parsed as text, never executed or served back | `test_upload_safety` |
| File exposure | Files stored as bytes in Postgres; no public URL; downloads only through authenticated, org-scoped endpoints | code review |
| Error leakage | Unhandled exceptions return a generic message with a request ID; detail goes to logs only | `test_failed_commit_writes_nothing_and_can_retry` asserts the internal message is not returned |
| Headers | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `COOP`, `CSP`, `Cache-Control: no-store` | `test_errors_use_consistent_envelope_and_request_id` |
| Secrets | Environment variables; `.env` ignored; production startup refuses default or short secret and insecure cookies | `test_production_config_refuses_default_secret` |
| Destructive data | Tenant deletion blocked when financial records exist; DB FKs `RESTRICT` | `test_tenant_with_financial_records_cannot_be_deleted` |
| Audit trail | Append-only `audit_log` with before/after; `review_decisions` for every reviewer action; accepted exceptions remain visible | `test_exception_lifecycle` |
| Dependencies | `pip-audit`: no known vulnerabilities. `pnpm audit --prod`: Next.js 16.0.10 had 4 critical and 15 high advisories; upgraded to 16.4.2 with `postcss` and `sharp` overrides; now none | CI `dependency-audit` job |

## Findings fixed in this review

- F-07 session revocation, F-08 login throttling, F-10 error envelope and headers, F-11 production config guard (see `docs/ENGINEERING_AUDIT.md`).
- Next.js critical advisories (RCE in image optimization and `use cache`) via upgrade.

## Open items before real customer data

1. HTTPS termination and HSTS at the edge; set `VEYRA_ENV=production`, `VEYRA_COOKIE_SECURE=true`.
2. The rate limiter is in-process. Multiple API instances need a shared store (Redis) or edge rate limiting.
3. Encryption at rest and encrypted backups (managed Postgres).
4. MFA, password policy and account recovery. No password reset flow exists.
5. Roles. Every user in an organization can approve rules and accept exceptions. Preparer and reviewer separation is not enforced.
6. Retention: no automatic deletion of source files. Define a retention period per customer agreement and add a purge job.
7. Make `audit_log` append-only at the database level (a role without UPDATE/DELETE).
8. Virus scanning if uploaded files will ever be opened outside the app.
9. Penetration test and a review of the Next.js proxy configuration in the chosen hosting environment.
10. The dependency audit job is report-only. Make it blocking once a triage policy exists.

Do not describe Veyra as enterprise-secure until items 1 to 7 are done and verified.
