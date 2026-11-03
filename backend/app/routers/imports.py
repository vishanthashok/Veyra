"""File imports: upload and preview, validate, atomic commit, history, error reports.

Storage (source_files) is separate from parsing (services/imports.py). Commits are atomic:
either every accepted row is written or none is, and a failed commit can be retried.
"""

import csv
import io
import logging
import uuid

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as M
from ..auth import Actor, current_actor
from ..config import settings
from ..db import SessionLocal, get_session
from ..schemas import CommitIn, CommitOut, ImportOut, ImportPreview
from ..scoping import get_owned, idempotency_key, log, scoped
from ..services import imports as I

router = APIRouter()
logger = logging.getLogger("veyra.imports")


def batch_out(db, b: M.ImportBatch) -> ImportOut:
    sf = db.get(M.SourceFile, b.source_file_id)
    out = ImportOut.model_validate(b)
    out.filename = sf.filename if sf else ""
    out.sha256 = sf.sha256 if sf else ""
    return out


def _preview(db, batch: M.ImportBatch, df, warnings) -> ImportPreview:
    req, opt = I.FIELDS[batch.kind]
    return ImportPreview(
        batch=batch_out(db, batch),
        columns=list(df.columns),
        rows=df.head(20).to_dict(orient="records"),
        required_fields=req,
        optional_fields=opt,
        suggested_map=I.suggest_map(batch.kind, list(df.columns)),
        warnings=warnings,
    )


def _committed_duplicate(db, actor, pid, kind, digest):
    return db.scalar(
        select(M.ImportBatch)
        .join(M.SourceFile, M.SourceFile.id == M.ImportBatch.source_file_id)
        .where(
            M.ImportBatch.organization_id == actor.org_id,
            M.ImportBatch.property_id == pid,
            M.ImportBatch.kind == kind,
            M.ImportBatch.status == "committed",
            M.SourceFile.sha256 == digest,
        )
    )


@router.post("/properties/{pid}/imports", response_model=ImportPreview, status_code=201)
async def upload(
    pid: uuid.UUID,
    kind: str = Form(...),
    file: UploadFile = File(...),
    idem: str | None = Header(None, alias="Idempotency-Key"),
    actor: Actor = Depends(current_actor),
    db: Session = Depends(get_session),
):
    get_owned(db, M.Property, pid, actor)
    key = idempotency_key(idem)
    if key:
        prior = db.scalar(scoped(M.ImportBatch, actor).where(M.ImportBatch.idempotency_key == key))
        if prior:
            sf = db.get(M.SourceFile, prior.source_file_id)
            return _preview(db, prior, I.read_table(I.sniff_kind(sf.filename, sf.content), sf.content), [])
    if kind not in I.FIELDS:
        raise HTTPException(422, f"kind must be one of {', '.join(I.FIELDS)}")
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(413, "File exceeds the 10 MB limit.")
    if not content:
        raise HTTPException(422, "File is empty.")
    filename = (file.filename or "upload").replace("/", "_").replace("\\", "_")[:300]
    try:
        fmt = I.sniff_kind(filename, content)
        df = I.read_table(fmt, content)
    except I.ImportError_ as e:
        raise HTTPException(422, str(e)) from e
    except Exception as e:
        raise HTTPException(422, "Could not read the file. Check that it is a valid CSV or XLSX.") from e

    digest = I.sha256(content)
    warnings = []
    prior = _committed_duplicate(db, actor, pid, kind, digest)
    if prior:
        warnings.append(
            f"An identical file was already committed on {prior.created_at:%Y-%m-%d}. "
            "Committing again would duplicate every row and needs explicit confirmation."
        )
    sf = M.SourceFile(
        organization_id=actor.org_id,
        filename=filename,
        content_type=file.content_type or "",
        sha256=digest,
        size_bytes=len(content),
        content=content,
        uploaded_by=actor.user_id,
    )
    db.add(sf)
    db.flush()
    batch = M.ImportBatch(
        organization_id=actor.org_id,
        property_id=pid,
        kind=kind,
        source_file_id=sf.id,
        row_count=len(df),
        created_by=actor.user_id,
        parser_version=I.PARSER_VERSION,
        idempotency_key=key,
    )
    db.add(batch)
    db.flush()
    log(db, actor, "upload", batch, after={"filename": filename, "sha256": digest, "rows": len(df)})
    db.commit()
    return _preview(db, batch, df, warnings)


@router.post("/imports/{bid}/validate", response_model=CommitOut)
def validate(bid: uuid.UUID, body: CommitIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    """Dry run: the exact accept/reject result a commit would produce. Writes nothing."""
    batch = get_owned(db, M.ImportBatch, bid, actor)
    result = _plan(db, actor, batch, body)
    db.rollback()
    out = batch_out(db, batch)
    out.accepted_count = result["accepted"]
    out.rejected_rows = result["rejected"]
    return CommitOut(batch=out, warnings=result["warnings"], dry_run=True)


@router.post("/imports/{bid}/commit", response_model=CommitOut)
def commit(
    bid: uuid.UUID,
    body: CommitIn,
    request: Request,
    actor: Actor = Depends(current_actor),
    db: Session = Depends(get_session),
):
    batch = get_owned(db, M.ImportBatch, bid, actor)
    if batch.status == "committed":
        raise HTTPException(409, "This import was already committed.")
    sf = db.get(M.SourceFile, batch.source_file_id)
    if not body.allow_duplicate_file and _committed_duplicate(db, actor, batch.property_id, batch.kind, sf.sha256):
        raise HTTPException(
            409,
            "An identical file was already committed for this property. "
            "Confirm to import it again; every row would be duplicated.",
        )
    try:
        result = _plan(db, actor, batch, body)
        batch.status = "committed"
        batch.column_map = body.column_map
        batch.accepted_count = result["accepted"]
        batch.rejected_rows = result["rejected"]
        log(db, actor, "commit", batch, after={"accepted": result["accepted"], "rejected": len(result["rejected"])})
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.exception("import commit failed", extra={"request_id": request.state.request_id})
        with SessionLocal() as s2:  # record the failure outside the rolled-back transaction
            b2 = s2.get(M.ImportBatch, bid)
            b2.status = "failed"
            s2.commit()
        raise HTTPException(500, "Import failed and nothing was written. You can retry the commit.") from None
    return CommitOut(batch=batch_out(db, batch), warnings=result["warnings"])


def _plan(db, actor, batch: M.ImportBatch, body: CommitIn) -> dict:
    """Validate rows and stage inserts in the current transaction. Caller commits or rolls back."""
    sf = db.get(M.SourceFile, batch.source_file_id)
    df = I.read_table(I.sniff_kind(sf.filename, sf.content), sf.content)
    try:
        rows = list(I.validate_rows(batch.kind, df, body.column_map))
    except I.ImportError_ as e:
        raise HTTPException(422, str(e)) from e
    pid = batch.property_id
    tenants = db.scalars(scoped(M.Tenant, actor).where(M.Tenant.property_id == pid)).all()
    match = I.TenantMatcher(tenants)
    if batch.kind == "gl":
        return I.stage_gl(db, actor, batch, rows)
    if batch.kind == "billings":
        return I.stage_billings(db, actor, batch, rows, match)
    return I.stage_lease_rules(db, actor, batch, rows, match, sf.filename)


@router.get("/properties/{pid}/imports", response_model=list[ImportOut])
def history(pid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    batches = db.scalars(
        scoped(M.ImportBatch, actor).where(M.ImportBatch.property_id == pid).order_by(M.ImportBatch.created_at.desc())
    ).all()
    return [batch_out(db, b) for b in batches]


@router.get("/imports/{bid}/errors.csv")
def error_report(bid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    batch = get_owned(db, M.ImportBatch, bid, actor)
    buf = io.StringIO()
    w = csv.writer(buf)
    fields = sorted({k for r in batch.rejected_rows for k in r.get("values", {})})
    w.writerow(["source_row", "errors", *fields])
    for r in batch.rejected_rows:
        w.writerow([r["row"], "; ".join(r["errors"]), *[r["values"].get(f, "") for f in fields]])
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="import_{bid}_errors.csv"'},
    )
