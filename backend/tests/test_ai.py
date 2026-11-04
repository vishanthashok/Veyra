from app.ai import LeaseExtractionResult, LeaseTermProposal


def test_populated_term_requires_source_evidence():
    try:
        LeaseTermProposal(field_name="cam_recovery", proposed_value="100%")
    except ValueError as exc:
        assert "source_page" in str(exc)
    else:
        raise AssertionError("populated terms without citations must be rejected")


def test_empty_term_can_report_not_found_without_source():
    term = LeaseTermProposal(field_name="tenant_audit_rights")
    assert term.proposed_value is None
    assert term.source_page is None


def test_extraction_limits_terms_and_conflicts():
    result = LeaseExtractionResult(
        terms=[LeaseTermProposal(field_name="expense_cap", proposed_value="5%", source_page=12, supporting_excerpt="cap")],
        conflicts=["Amendment may supersede section 6"],
    )
    assert result.terms[0].source_page == 12
    assert result.conflicts
