"""Built-in workflow templates. Each is an ordinary definition; "{{property}}" is replaced with
the property chosen when a workflow is created from a template that reads Veyra data."""

from __future__ import annotations

import copy
import json
from typing import Any

PROPERTY = "{{property}}"


def _n(id_: str, type_: str, label: str, x: float, y: float, **config: Any) -> dict[str, Any]:
    return {"id": id_, "type": type_, "label": label, "position": {"x": x, "y": y}, "config": config}


def _e(source: str, target: str, source_port: str = "out", target_port: str = "in") -> dict[str, Any]:
    return {
        "id": f"{source}.{source_port}-{target}.{target_port}",
        "source": source,
        "source_port": source_port,
        "target": target,
        "target_port": target_port,
    }


GL_MAPPING = [
    {"target": "gl_account", "source": "", "required": True},
    {"target": "account_name", "source": "", "required": False},
    {"target": "txn_date", "source": "", "required": True},
    {"target": "amount", "source": "", "required": True},
    {"target": "vendor", "source": "", "required": False},
    {"target": "description", "source": "", "required": False},
]

GL_CLEANER: dict[str, Any] = {
    "nodes": [
        _n("upload", "spreadsheet_upload", "GL export", 0, 120, input_label="General ledger (CSV or XLSX)"),
        _n("columns", "column_mapper", "Validate columns", 260, 120, mapping=GL_MAPPING, keep_unmapped=False),
        _n(
            "clean",
            "data_cleaner",
            "Normalize values",
            520,
            120,
            trim=True,
            date_columns=["txn_date"],
            amount_columns=["amount"],
            code_columns=["gl_account"],
            required_columns=["gl_account", "txn_date", "amount"],
            warn_blank_columns=["description"],
            reject_invalid=True,
        ),
        _n(
            "dedupe",
            "deduplicate",
            "Detect duplicates",
            780,
            60,
            key_columns=["gl_account", "txn_date", "amount", "description"],
        ),
        _n("xlsx", "excel_export", "Cleaned workbook", 1040, 60, filename="gl-cleaned.xlsx", include_issues=True),
        _n("csv", "csv_export", "Cleaned CSV", 1040, 220, filename="gl-cleaned.csv"),
    ],
    "edges": [
        _e("upload", "columns"),
        _e("columns", "clean"),
        _e("clean", "dedupe"),
        _e("dedupe", "xlsx", "out", "sheets"),
        _e("dedupe", "xlsx", "removed", "sheets"),
        _e("clean", "xlsx", "rejected", "sheets"),
        _e("dedupe", "csv"),
    ],
}

CLASSIFICATION: dict[str, Any] = {
    "nodes": [
        _n("upload", "spreadsheet_upload", "GL export", 0, 120, input_label="General ledger (CSV or XLSX)"),
        _n("columns", "column_mapper", "Map columns", 260, 120, mapping=GL_MAPPING),
        _n(
            "clean",
            "data_cleaner",
            "Normalize values",
            520,
            120,
            date_columns=["txn_date"],
            amount_columns=["amount"],
            code_columns=["gl_account"],
            required_columns=["gl_account", "amount"],
        ),
        _n(
            "map",
            "category_mapper",
            "Apply approved mappings",
            780,
            120,
            account_column="gl_account",
            source="property",
            property_id=PROPERTY,
        ),
        _n(
            "classify",
            "expense_classification",
            "Classify",
            1040,
            120,
            status_column="mapping_status",
            amount_column="amount",
        ),
        _n("xlsx", "excel_export", "Classification workbook", 1300, 120, filename="expense-classification.xlsx"),
    ],
    "edges": [
        _e("upload", "columns"),
        _e("columns", "clean"),
        _e("clean", "map"),
        _e("map", "classify"),
        _e("classify", "xlsx", "recoverable", "sheets"),
        _e("classify", "xlsx", "nonrecoverable", "sheets"),
        _e("classify", "xlsx", "review", "sheets"),
        _e("clean", "xlsx", "rejected", "sheets"),
    ],
}

BILLING: dict[str, Any] = {
    "nodes": [
        _n("alloc", "tenant_allocation", "Approved allocations", 0, 40, property_id=PROPERTY, variance_threshold=500),
        _n("upload", "spreadsheet_upload", "Tenant billings", 0, 220, input_label="Tenant billings (CSV or XLSX)"),
        _n(
            "columns",
            "column_mapper",
            "Map billing columns",
            260,
            220,
            mapping=[
                {"target": "tenant", "source": "", "required": True},
                {"target": "amount", "source": "", "required": True},
                {"target": "bill_date", "source": "", "required": False},
            ],
        ),
        _n(
            "clean",
            "data_cleaner",
            "Normalize amounts",
            520,
            220,
            amount_columns=["amount"],
            date_columns=["bill_date"],
            required_columns=["tenant", "amount"],
        ),
        _n(
            "compare",
            "billing_comparison",
            "Compare billings",
            780,
            120,
            allocation_key="suite",
            billing_key="tenant",
            variance_threshold=500,
        ),
        _n("xlsx", "excel_export", "Comparison workbook", 1040, 120, filename="tenant-billing-comparison.xlsx"),
    ],
    "edges": [
        _e("upload", "columns"),
        _e("columns", "clean"),
        _e("alloc", "compare", "out", "allocations"),
        _e("clean", "compare", "out", "billings"),
        _e("compare", "xlsx", "out", "sheets"),
        _e("compare", "xlsx", "unmatched", "sheets"),
        _e("alloc", "xlsx", "out", "sheets"),
    ],
}

LEASE: dict[str, Any] = {
    "nodes": [
        _n("roster", "spreadsheet_upload", "Tenant roster", 0, 40, input_label="Tenant roster with rule references"),
        _n(
            "columns",
            "column_mapper",
            "Map roster columns",
            260,
            40,
            mapping=[
                {"target": "suite", "source": "", "required": True},
                {"target": "tenant", "source": "", "required": True},
                {"target": "rule_ref", "source": "", "required": True},
            ],
        ),
        _n("rules", "property_data", "Structured lease rules", 260, 220, property_id=PROPERTY, dataset="lease_rules"),
        _n("check", "lease_rule_check", "Check rule completeness", 520, 120),
        _n("xlsx", "excel_export", "Lease readiness report", 780, 120, filename="lease-readiness.xlsx"),
    ],
    "edges": [
        _e("roster", "columns"),
        _e("columns", "check", "out", "tenants"),
        _e("rules", "check", "out", "rules"),
        _e("check", "xlsx", "out", "sheets"),
    ],
}

PRECLOSE: dict[str, Any] = {
    "nodes": [
        _n("gl", "property_data", "Imported GL", 0, 0, property_id=PROPERTY, dataset="gl"),
        _n(
            "gl_check",
            "exception_detection",
            "Validate GL",
            260,
            0,
            required_columns=["gl_account", "txn_date", "amount"],
            amount_columns=["amount"],
            unique_columns=["gl_account", "txn_date", "amount", "description"],
        ),
        _n("map", "category_mapper", "Map expenses", 520, 0, source="property", property_id=PROPERTY),
        _n("classify", "expense_classification", "Classify", 780, 0),
        _n("tenants", "property_data", "Tenant roster", 0, 200, property_id=PROPERTY, dataset="tenants"),
        _n("rules", "property_data", "Lease rules", 0, 340, property_id=PROPERTY, dataset="lease_rules"),
        _n("lease", "lease_rule_check", "Verify required rules", 260, 260),
        _n("alloc", "tenant_allocation", "Provisional calculation", 520, 400, property_id=PROPERTY),
        _n("bills", "property_data", "Billing records", 520, 540, property_id=PROPERTY, dataset="billings"),
        _n("compare", "billing_comparison", "Billing comparison", 780, 460, billing_key="suite"),
        _n(
            "gate",
            "approval_gate",
            "Reviewer sign-off",
            1040,
            260,
            instructions=(
                "Review exceptions, unmapped accounts and blocked tenants before the readiness workbook is issued."
            ),
        ),
        _n("xlsx", "excel_export", "Readiness workbook", 1300, 200, filename="cam-preclose-readiness.xlsx"),
        _n("report", "exception_report", "Exception report", 1300, 360, filename="cam-preclose-exceptions.xlsx"),
    ],
    "edges": [
        _e("gl", "gl_check"),
        _e("gl_check", "map"),
        _e("map", "classify"),
        _e("tenants", "lease", "out", "tenants"),
        _e("rules", "lease", "out", "rules"),
        _e("alloc", "compare", "out", "allocations"),
        _e("bills", "compare", "out", "billings"),
        _e("compare", "gate"),
        _e("gate", "xlsx", "out", "sheets"),
        _e("lease", "xlsx", "out", "sheets"),
        _e("classify", "xlsx", "recoverable", "sheets"),
        _e("classify", "xlsx", "nonrecoverable", "sheets"),
        _e("classify", "xlsx", "review", "sheets"),
        _e("gate", "report"),
        _e("lease", "report"),
        _e("classify", "report", "review", "in"),
    ],
}

TEMPLATES: list[dict[str, Any]] = [
    {
        "key": "gl_expense_cleaner",
        "name": "GL expense cleaner",
        "category": "data_quality",
        "description": (
            "Validate GL columns, normalize dates, amounts and account codes, set aside duplicates and flag "
            "missing descriptions and invalid amounts. Produces a cleaned workbook with an exception sheet."
        ),
        "definition": GL_CLEANER,
        "version": 1,
    },
    {
        "key": "cam_expense_classification",
        "name": "CAM expense classification",
        "category": "cam",
        "description": (
            "Normalize a GL export, apply the property's approved expense mappings and split recoverable, "
            "nonrecoverable and review-required expenses. Unknown accounts are flagged, never guessed."
        ),
        "definition": CLASSIFICATION,
        "version": 1,
    },
    {
        "key": "tenant_billing_comparison",
        "name": "Tenant billing comparison",
        "category": "cam",
        "description": (
            "Calculate approved allocations with Veyra's engine, match a billing spreadsheet by suite and report "
            "provisional differences and unmatched billings."
        ),
        "definition": BILLING,
        "version": 1,
    },
    {
        "key": "lease_rule_audit",
        "name": "Lease rule completeness audit",
        "category": "lease",
        "description": (
            "Match a tenant roster to the property's structured lease rules and flag missing, unapproved, "
            "incomplete or unsupported rules."
        ),
        "definition": LEASE,
        "version": 1,
    },
    {
        "key": "cam_preclose_readiness",
        "name": "CAM pre-close readiness",
        "category": "cam",
        "description": (
            "Validate imported data, map expenses, verify lease rules, run provisional calculations and billing "
            "comparison, then pause for reviewer sign-off before issuing the readiness workbook and exception "
            "report."
        ),
        "definition": PRECLOSE,
        "version": 1,
    },
]

BY_KEY = {t["key"]: t for t in TEMPLATES}


def needs_property(defn: dict[str, Any]) -> bool:
    return PROPERTY in json.dumps(defn)


def instantiate(key: str, property_id: str | None) -> dict[str, Any]:
    t = BY_KEY[key]
    defn = copy.deepcopy(t["definition"])
    for n in defn["nodes"]:
        for k, v in list(n["config"].items()):
            if v == PROPERTY:
                n["config"][k] = property_id or ""
    return defn
