# Veyra AI security

- API keys are server-only environment variables; no browser bundle receives them.
- Uploaded lease text is untrusted evidence. The extraction prompt explicitly treats it as data and ignores embedded instructions.
- AI proposals are stored separately from approved lease rules. No model response directly changes a financial input.
- Uploads and all extraction rows carry organization scope. Document lookup verifies the authenticated organization and property/tenant ownership.
- PDF text is bounded by page and total-context limits.
- Extraction requires source page and excerpt for every populated value.
- A reviewer must approve each term. Applying a review creates a draft rule; the existing rule approval action remains mandatory.
- Scanned PDFs fail visibly with an OCR-required status; the system does not guess.
- Remaining hardening: background jobs, malware scanning, OCR integration, per-organization AI budgets, and a production secrets manager.
