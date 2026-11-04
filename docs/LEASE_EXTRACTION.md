# Lease extraction workflow

1. Upload a PDF from a property tenant's Documents screen.
2. Veyra stores the original bytes immutably and extracts page text.
3. Start analysis. If `VEYRA_OPENAI_API_KEY` is absent, the feature is visibly disabled.
4. Review each proposed term, source page, excerpt, confidence, and uncertainty.
5. Approve or reject every term.
6. Apply reviewed terms. Veyra creates a draft lease rule and never marks it approved.
7. Open Lease Rules, verify the clause, complete any missing allocation fields, and explicitly approve the rule.

Unreadable/scanned PDFs are not silently analyzed. OCR is a documented follow-up milestone.
