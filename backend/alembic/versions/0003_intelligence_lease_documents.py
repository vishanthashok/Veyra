"""v0.3 lease intelligence: immutable document versions and reviewable AI proposals."""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    uuid = sa.Uuid()
    op.create_table(
        "lease_documents",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("organization_id", uuid, sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("property_id", uuid, sa.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("tenant_id", uuid, sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("document_type", sa.String(30), nullable=False),
        sa.Column("filename", sa.String(300), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="uploaded"),
        sa.Column("current_version_id", uuid, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "document_versions",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("organization_id", uuid, sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("document_id", uuid, sa.ForeignKey("lease_documents.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("source_file_id", uuid, sa.ForeignKey("source_files.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("version_number", sa.Integer, nullable=False),
        sa.Column("processing_status", sa.String(30), nullable=False),
        sa.Column("page_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("extracted_text", sa.Text, nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("document_id", "version_number"),
    )
    op.create_foreign_key("lease_documents_current_version_fk", "lease_documents", "document_versions", ["current_version_id"], ["id"])
    op.create_table(
        "lease_extractions",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("organization_id", uuid, sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("document_version_id", uuid, sa.ForeignKey("document_versions.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("provider", sa.String(30), nullable=False),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("conflicts", sa.JSON, nullable=False, server_default=sa.text("\'[]\'::json")),
        sa.Column("incomplete_document_warning", sa.Text, nullable=True),
        sa.Column("input_tokens", sa.Integer, nullable=True),
        sa.Column("output_tokens", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "extracted_lease_terms",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("organization_id", uuid, sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("extraction_id", uuid, sa.ForeignKey("lease_extractions.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("field_name", sa.String(60), nullable=False),
        sa.Column("proposed_value", sa.Text, nullable=True),
        sa.Column("source_page", sa.Integer, nullable=True),
        sa.Column("supporting_excerpt", sa.Text, nullable=True),
        sa.Column("confidence", sa.String(20), nullable=False),
        sa.Column("uncertainty", sa.Text, nullable=False, server_default=""),
        sa.Column("review_status", sa.String(20), nullable=False, server_default="needs_review"),
        sa.Column("review_note", sa.Text, nullable=False, server_default=""),
        sa.Column("reviewed_by", uuid, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "ai_requests",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("organization_id", uuid, sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("feature", sa.String(50), nullable=False),
        sa.Column("provider", sa.String(30), nullable=False),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("input_tokens", sa.Integer, nullable=True),
        sa.Column("output_tokens", sa.Integer, nullable=True),
        sa.Column("estimated_cost_usd", sa.Numeric(12, 6), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("ai_requests")
    op.drop_table("extracted_lease_terms")
    op.drop_table("lease_extractions")
    op.drop_constraint("lease_documents_current_version_fk", "lease_documents", type_="foreignkey")
    op.drop_table("document_versions")
    op.drop_table("lease_documents")
