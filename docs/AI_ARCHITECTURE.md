# Veyra AI architecture

Veyra AI is a server-side, provider-abstracted proposal system. The deterministic CAM engine remains the only authority for allocation results.

## Current vertical slice

Lease PDFs are uploaded into the existing immutable `source_files` store. A versioned document record stores page-separated extracted text. The lease extractor returns Pydantic-validated proposals with a field name, value, source page, excerpt, confidence, and uncertainty. Proposals are persisted separately from `lease_rules`.

The review lifecycle is:

`uploaded -> text_extracted -> needs_review -> applied`

Applying a reviewed extraction creates a **draft** lease rule. The existing lease-rule approval flow is still required before calculations can use it.

## Provider boundary

`app/ai.py` is intentionally narrow. It reads `VEYRA_OPENAI_API_KEY` server-side and calls the official OpenAI Responses SDK with Pydantic structured parsing. Provider errors are converted to a safe application error; malformed source references are rejected.

Future providers should implement the same extraction contract rather than leaking provider-specific response shapes into routers.

## Context and tools

Lease extraction receives only page-bounded text from the selected document. It has no application tools and no write capability. Future copilot tools must be read-only, organization-scoped, bounded, and citation-producing.
