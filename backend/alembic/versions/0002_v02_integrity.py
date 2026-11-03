"""v0.2: data integrity, audit snapshots, session revocation, idempotency, versions.

Additive only. No existing rows are rewritten or deleted.
- Tenant FKs on cam_billings, audit_results, exceptions change from CASCADE to RESTRICT, so a
  tenant delete can no longer destroy billing or audit history (F-02).
- audit_runs gains engine_version and snapshot (nullable: v0.1 runs have no snapshot and are
  reported as "not reproducible" rather than being backfilled with guessed data).

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

RESTRICT = [("cam_billings", "tenant_id"), ("audit_results", "tenant_id"), ("exceptions", "tenant_id")]


def upgrade() -> None:
    op.add_column("users", sa.Column("session_version", sa.Integer(), server_default="0", nullable=False))
    op.add_column("lease_rules", sa.Column("version", sa.Integer(), server_default="1", nullable=False))
    op.add_column("expense_mappings", sa.Column("version", sa.Integer(), server_default="0", nullable=False))
    op.add_column("import_batches", sa.Column("parser_version", sa.String(20), server_default="1", nullable=False))
    op.add_column("import_batches", sa.Column("idempotency_key", sa.String(200), nullable=True))
    op.create_unique_constraint("uq_import_batches_org_idem", "import_batches", ["organization_id", "idempotency_key"])
    op.add_column("audit_runs", sa.Column("engine_version", sa.String(20), server_default="0.1.0", nullable=False))
    op.add_column("audit_runs", sa.Column("snapshot", sa.JSON(), nullable=True))
    op.add_column("audit_runs", sa.Column("idempotency_key", sa.String(200), nullable=True))
    op.create_unique_constraint("uq_audit_runs_org_idem", "audit_runs", ["organization_id", "idempotency_key"])
    op.create_index("ix_audit_runs_property_created", "audit_runs", ["property_id", "created_at"])
    op.add_column("exceptions", sa.Column("assigned_to", sa.Uuid(), nullable=True))
    op.create_foreign_key("exceptions_assigned_to_fkey", "exceptions", "users", ["assigned_to"], ["id"])
    op.create_index("ix_gl_transactions_property_account_date", "gl_transactions",
                    ["property_id", "gl_account", "txn_date"])
    op.create_index("ix_review_decisions_target", "review_decisions", ["target_type", "target_id"])
    for table, col in RESTRICT:
        op.drop_constraint(f"{table}_{col}_fkey", table, type_="foreignkey")
        op.create_foreign_key(f"{table}_{col}_fkey", table, "tenants", [col], ["id"], ondelete="RESTRICT")


def downgrade() -> None:
    for table, col in RESTRICT:
        op.drop_constraint(f"{table}_{col}_fkey", table, type_="foreignkey")
        op.create_foreign_key(f"{table}_{col}_fkey", table, "tenants", [col], ["id"], ondelete="CASCADE")
    op.drop_index("ix_review_decisions_target", "review_decisions")
    op.drop_index("ix_gl_transactions_property_account_date", "gl_transactions")
    op.drop_constraint("exceptions_assigned_to_fkey", "exceptions", type_="foreignkey")
    op.drop_column("exceptions", "assigned_to")
    op.drop_index("ix_audit_runs_property_created", "audit_runs")
    op.drop_constraint("uq_audit_runs_org_idem", "audit_runs", type_="unique")
    for c in ("idempotency_key", "snapshot", "engine_version"):
        op.drop_column("audit_runs", c)
    op.drop_constraint("uq_import_batches_org_idem", "import_batches", type_="unique")
    op.drop_column("import_batches", "idempotency_key")
    op.drop_column("import_batches", "parser_version")
    op.drop_column("expense_mappings", "version")
    op.drop_column("lease_rules", "version")
    op.drop_column("users", "session_version")
