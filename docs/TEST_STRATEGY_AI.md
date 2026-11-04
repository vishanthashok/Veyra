# AI milestone test strategy

The lease extraction boundary should be tested without paid API calls:

- Pydantic rejects populated terms without a page or excerpt.
- Prompt input is bounded and document text is treated as untrusted.
- Missing API credentials produce a disabled feature state.
- Provider failures do not persist partial terms.
- Document and extraction endpoints reject cross-organization identifiers.
- Applying terms requires every proposed term to be reviewed and creates a draft rule.
- Existing deterministic engine tests remain unchanged and continue to be the regression gate.

An integration suite may use a configured provider separately; normal CI should use mocked `extract_lease_terms` responses.
