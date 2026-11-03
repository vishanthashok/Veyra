> v0.1 document, kept for history. The current version is [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md).

# Security status

Veyra v0.1 is a local-first MVP. It is not production-secure. Use synthetic data only until the items under "Required before real customer data" are done.

## In place

- Password hashes with argon2. Signed, httpOnly, SameSite=Lax session cookie with an 8 hour lifetime.
- Organization isolation: every query filters by the caller's organization. Foreign rows return 404. Tested in `test_org_isolation`.
- Uploads: only `.csv` and `.xlsx`, XLSX magic-byte check, UTF-8 check for CSV, 10 MB limit, filename sanitized. Files are parsed as text, never executed.
- Uploaded files stored in the database, not in a public folder or bucket.
- Secrets read from environment variables. `.env` is git-ignored.
- Append-only `audit_log` with before and after values for every change, plus `review_decisions` for every reviewer action.
- Input validation through Pydantic schemas. Money never passes through floats.

## Required before real customer data

1. Set a strong `VEYRA_SECRET_KEY` and `VEYRA_COOKIE_SECURE=true`. Serve only over HTTPS.
2. Encrypt the database and backups at rest. Use a managed Postgres with encryption and point-in-time recovery.
3. Add rate limiting and lockout on login. Add MFA for all users.
4. Add CSRF protection for state-changing requests if the API is ever exposed on a different origin.
5. Add roles (preparer, reviewer, client viewer) and enforce them on approvals.
6. Define retention: how long source files and results are kept, and a deletion procedure on request.
7. Sign a confidentiality agreement or DPA with each pilot customer before receiving files. Record what was received and when.
8. Restrict who can access production. Use separate credentials per person. Log access.
9. Run a dependency audit (`uv pip audit` or equivalent, `pnpm audit`) and fix high findings.
10. Write an incident response note: who to tell, within what time, and how.
11. Move audit_log writes to a role that cannot update or delete rows.
12. Consider virus scanning of uploads if files are opened by people outside the app.

Until all 12 are done, accept customer files only on an encrypted laptop, process them locally, and delete them after delivery as agreed in writing.
