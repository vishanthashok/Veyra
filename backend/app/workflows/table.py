"""The data contract between workflow nodes.

Every edge carries a Table: ordered column names, rows of text values, and for each row the
source row number it came from (or None for rows a node created). Values stay text so that
nothing is lost to float conversion; nodes that do arithmetic parse with Decimal and write the
result back as canonical text. Issues are row-level findings that do not stop the run.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

MAX_ROWS = 50_000
MAX_COLUMNS = 200
PREVIEW_ROWS = 50
MAX_ISSUES_PER_STEP = 2_000


class NodeError(Exception):
    """A configuration or input problem that stops the step. The message is shown to the user."""


@dataclass
class Table:
    columns: list[str]
    rows: list[dict[str, str]] = field(default_factory=list)
    source_rows: list[int | None] = field(default_factory=list)
    source: str = ""

    def __post_init__(self) -> None:
        if not self.source_rows and self.rows:
            self.source_rows = [None] * len(self.rows)
        if len(self.source_rows) != len(self.rows):
            raise ValueError("source_rows must align with rows")

    def __len__(self) -> int:
        return len(self.rows)

    def copy_shape(self, columns: list[str] | None = None) -> Table:
        return Table(columns=list(columns if columns is not None else self.columns), source=self.source)

    def append(self, row: dict[str, str], source_row: int | None) -> None:
        self.rows.append(row)
        self.source_rows.append(source_row)

    def require(self, *cols: str, node: str = "") -> None:
        missing = [c for c in cols if c and c not in self.columns]
        if missing:
            where = f" for {node}" if node else ""
            raise NodeError(
                f"Column{'s' if len(missing) > 1 else ''} {', '.join(repr(m) for m in missing)} not found{where}. "
                f"Available: {', '.join(self.columns) or 'none'}."
            )

    def preview(self, n: int = PREVIEW_ROWS) -> dict[str, Any]:
        return {
            "columns": self.columns,
            "rows": [[r.get(c, "") for c in self.columns] for r in self.rows[:n]],
            "source_rows": self.source_rows[:n],
            "row_count": len(self.rows),
        }

    def to_json_bytes(self) -> bytes:
        payload = {"columns": self.columns, "rows": self.rows, "source_rows": self.source_rows, "source": self.source}
        return gzip.compress(json.dumps(payload, separators=(",", ":")).encode())

    @classmethod
    def from_json_bytes(cls, data: bytes) -> Table:
        p = json.loads(gzip.decompress(data))
        return cls(columns=p["columns"], rows=p["rows"], source_rows=p["source_rows"], source=p.get("source", ""))


def issue(
    severity: str, code: str, message: str, row: int | None = None, column: str | None = None, value: str | None = None
) -> dict[str, Any]:
    out: dict[str, Any] = {"severity": severity, "code": code, "message": message}
    if row is not None:
        out["row"] = row
    if column:
        out["column"] = column
    if value is not None:
        out["value"] = value[:200]
    return out


# --- Parsing -----------------------------------------------------------------------------------


def cell_text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float):
        # Excel stores numbers as doubles; repr is the shortest exact round trip. 2400.0 -> "2400".
        s = repr(v)
        return s[:-2] if s.endswith(".0") else s
    if isinstance(v, datetime):
        return v.date().isoformat() if (v.hour, v.minute, v.second) == (0, 0, 0) else v.isoformat(sep=" ")
    if isinstance(v, date):
        return v.isoformat()
    return str(v).strip()


def sniff_format(filename: str, content: bytes) -> str:
    name = filename.lower()
    if name.endswith(".xlsx"):
        if not content.startswith(b"PK\x03\x04"):
            raise NodeError("The file has an .xlsx name but is not an XLSX workbook.")
        return "xlsx"
    if name.endswith(".csv"):
        if b"\x00" in content[:4096]:
            raise NodeError("The CSV file contains binary data.")
        try:
            content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise NodeError("CSV files must be UTF-8 encoded.") from exc
        return "csv"
    raise NodeError("Only .csv and .xlsx files are accepted.")


def _from_matrix(matrix: list[list[str]], header_row: int, source: str) -> Table:
    if len(matrix) < header_row:
        raise NodeError(f"Header row {header_row} is past the end of the sheet.")
    raw = matrix[header_row - 1]
    if len(raw) > MAX_COLUMNS:
        raise NodeError(f"The sheet has {len(raw)} columns. The limit is {MAX_COLUMNS}.")
    columns: list[str] = []
    for i, h in enumerate(raw):
        name = (h or "").strip() or f"Column {get_column_letter(i + 1)}"
        base, n = name, 2
        while name in columns:  # duplicate headers get a suffix rather than overwriting each other
            name, n = f"{base} ({n})", n + 1
        columns.append(name)
    t = Table(columns=columns, source=source)
    for offset, values in enumerate(matrix[header_row:], start=header_row + 1):
        if all((v or "").strip() == "" for v in values):
            continue  # fully blank spreadsheet lines are not data
        if len(t) >= MAX_ROWS:
            raise NodeError(f"The sheet has more than {MAX_ROWS:,} data rows. Split the file and run it in parts.")
        t.append({c: (values[i] if i < len(values) else "") for i, c in enumerate(columns)}, offset)
    return t


def list_sheets(filename: str, content: bytes) -> list[str]:
    if sniff_format(filename, content) == "csv":
        return ["CSV"]
    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    try:
        return [ws.title for ws in wb.worksheets]
    finally:
        wb.close()


def read_spreadsheet(filename: str, content: bytes, sheet: str = "", header_row: int = 1) -> Table:
    """Parse an untrusted upload. Formulas are never evaluated: cached values only (data_only)."""
    fmt = sniff_format(filename, content)
    if fmt == "csv":
        text = content.decode("utf-8-sig")
        matrix = [list(r) for r in csv.reader(io.StringIO(text))]
        return _from_matrix(matrix, header_row, filename)
    try:
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise NodeError("The workbook could not be read. Re-save it as .xlsx and try again.") from exc
    try:
        if sheet:
            if sheet not in wb.sheetnames:
                raise NodeError(f"Sheet {sheet!r} not found. Sheets: {', '.join(wb.sheetnames)}.")
            ws = wb[sheet]
        else:
            ws = wb.worksheets[0]
        matrix: list[list[str]] = []
        for r in ws.iter_rows(values_only=True):
            matrix.append([cell_text(c) for c in r])
            if len(matrix) > MAX_ROWS + header_row + 1000:  # allow blank lines, but stop runaway sheets early
                raise NodeError(f"The sheet has more than {MAX_ROWS:,} rows. Split the file and run it in parts.")
        return _from_matrix(matrix, header_row, f"{filename} / {ws.title}")
    finally:
        wb.close()


def to_decimal(v: str) -> Decimal | None:
    """Parse money and numbers. Accepts 1,234.50  $1,234.50  (1,234.50)  -1234.5. None if not numeric."""
    s = (v or "").strip().replace(",", "").replace("$", "").replace(" ", "")
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1]
    try:
        d = Decimal(s)
    except InvalidOperation:
        return None
    if not d.is_finite():
        return None
    return -d if neg else d


def fmt_decimal(d: Decimal, places: int = 2) -> str:
    q = Decimal(1).scaleb(-places)
    return str(d.quantize(q))


# --- Export: spreadsheet formula-injection protection -------------------------------------------

_DANGEROUS = ("=", "+", "-", "@", "\t", "\r", "\n")


def safe_text(v: str) -> str:
    """Neutralize cells that a spreadsheet app would execute as formulas (CSV injection).

    Plain numbers such as -12.50 are left alone so they stay numeric.
    """
    if v and v.startswith(_DANGEROUS) and to_decimal(v) is None:
        return "'" + v
    return v


MONEY_WORDS = ("amount", "total", "billed", "variance", "calculated", "difference", "debit", "credit", "fee")


def _numeric_columns(t: Table) -> set[str]:
    """Columns written as numbers: money-like names whose every value parses. Codes such as GL
    accounts stay text so leading zeros and identifiers are never altered."""
    out = set()
    for c in t.columns:
        if not any(w in c.lower() for w in MONEY_WORDS):
            continue
        vals = [r.get(c, "") for r in t.rows if r.get(c, "") != ""]
        if vals and all(to_decimal(v) is not None for v in vals):
            out.add(c)
    return out


def to_csv_bytes(t: Table) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow([safe_text(c) for c in t.columns])
    for r in t.rows:
        w.writerow([safe_text(r.get(c, "")) for c in t.columns])
    return buf.getvalue().encode("utf-8-sig")


HEADER_FILL = PatternFill("solid", fgColor="17191D")
NOTE_FONT = Font(color="676C75", size=9)


def to_xlsx_bytes(sheets: list[tuple[str, Table]], notes: list[str]) -> bytes:
    """One sheet per table, plus a cover sheet with provenance notes. Text is always written as
    text (never as a formula); numeric columns are written as Decimal values with a number format."""
    wb = Workbook()
    cover = wb.active
    cover.title = "Run"
    for i, line in enumerate(notes, start=1):
        c = cover.cell(row=i, column=1, value=safe_text(line))
        c.data_type = "s"
        if i == 1:
            c.font = Font(bold=True, size=13)
    cover.column_dimensions["A"].width = 110
    used: set[str] = {"Run"}
    for title, t in sheets:
        name = _sheet_name(title, used)
        ws = wb.create_sheet(name)
        cols = ["Source row", *t.columns]
        for j, h in enumerate(cols, start=1):
            c = ws.cell(row=1, column=j, value=safe_text(h))
            c.data_type = "s"
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = HEADER_FILL
            c.alignment = Alignment(vertical="center")
        numeric = _numeric_columns(t)
        for i, (r, src) in enumerate(zip(t.rows, t.source_rows, strict=True), start=2):
            ws.cell(row=i, column=1, value=src)
            for j, col in enumerate(t.columns, start=2):
                v = r.get(col, "")
                if col in numeric and v != "":
                    d = to_decimal(v)
                    cell = ws.cell(row=i, column=j, value=d)
                    cell.number_format = (
                        "#,##0.00;(#,##0.00)" if d is not None and d.as_tuple().exponent == -2 else "General"
                    )
                else:
                    # Forced string type: text that looks like a formula is stored and shown as
                    # text, never evaluated. (CSV has no cell types, so CSV uses safe_text.)
                    cell = ws.cell(row=i, column=j, value=v)
                    cell.data_type = "s"
        ws.freeze_panes = "B2"
        for j, col in enumerate(cols, start=1):
            width = max([len(col)] + [len(str(r.get(col, ""))) for r in t.rows[:200]]) + 2
            ws.column_dimensions[get_column_letter(j)].width = min(max(width, 10), 60)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _sheet_name(title: str, used: set[str]) -> str:
    base = "".join(ch for ch in title if ch not in "[]:*?/\\").strip()[:28] or "Sheet"
    name, n = base, 2
    while name in used:
        name, n = f"{base[:26]} {n}", n + 1
    used.add(name)
    return name
