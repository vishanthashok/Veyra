"""Imports, GL transactions, expense mappings."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models as M
from ..auth import Actor, current_actor
from ..config import settings
from ..db import get_session
from ..schemas import (
    CommitIn, CommitOut, GLAccountOut, GLTransactionOut, ImportOut, ImportPreview, MappingIn,
    ReviewIn,
)
from ..scoping import get_owned, log, scoped, snapshot
from ..services import imports as I

router = APIRouter()


def _batch_out(db, b: M.ImportBatch) -> ImportOut:
    sf = db.get(M.SourceFile, b.source_file_id)
    out = ImportOut.model_validate(b)
    out.filename = sf.filename if sf else ""
    return out


@router.post("/properties/{pid}/imports", response_model=ImportPreview, status_code=201)
async def upload(pid: uuid.UUID, kind: str = Form(...), file: UploadFile = File(...),
                 actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
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
        raise HTTPException(422, str(e))
    except Exception:
        raise HTTPException(422, "Could not read the file. Check that it is a valid CSV or XLSX.")

    digest = I.sha256(content)
    warnings = []
    prior = db.scalar(select(M.ImportBatch).join(M.SourceFile, M.SourceFile.id == M.ImportBatch.source_file_id)
                      .where(M.ImportBatch.organization_id == actor.org_id,
                             M.ImportBatch.property_id == pid, M.ImportBatch.kind == kind,
                             M.ImportBatch.status == "committed", M.SourceFile.sha256 == digest))
    if prior:
        warnings.append(f"An identical file was already committed on {prior.created_at:%Y-%m-%d}. "
                        "Committing again will create duplicate records.")
    sf = M.SourceFile(organization_id=actor.org_id, filename=filename,
                      content_type=file.content_type or "", sha256=digest,
                      size_bytes=len(content), content=content, uploaded_by=actor.user_id)
    db.add(sf)
    db.flush()
    batch = M.ImportBatch(organization_id=actor.org_id, property_id=pid, kind=kind,
                          source_file_id=sf.id, row_count=len(df), created_by=actor.user_id)
    db.add(batch)
    db.flush()
    log(db, actor, "upload", batch, after={"filename": filename, "sha256": digest, "rows": len(df)})
    db.commit()
    req, opt = I.FIELDS[kind]
    return ImportPreview(batch=_batch_out(db, batch), columns=list(df.columns),
                         rows=df.head(20).to_dict(orient="records"), required_fields=req,
                         optional_fields=opt, suggested_map=I.suggest_map(kind, list(df.columns)),
                         warnings=warnings)


@router.post("/imports/{bid}/commit", response_model=CommitOut)
def commit(bid: uuid.UUID, body: CommitIn, actor: Actor = Depends(current_actor),
           db: Session = Depends(get_session)):
    batch = get_owned(db, M.ImportBatch, bid, actor)
    if batch.status == "committed":
        raise HTTPException(409, "This import was already committed.")
    sf = db.get(M.SourceFile, batch.source_file_id)
    df = I.read_table(I.sniff_kind(sf.filename, sf.content), sf.content)
    try:
        rows = list(I.validate_rows(batch.kind, df, body.column_map))
    except I.ImportError_ as e:
        raise HTTPException(422, str(e))

    pid = batch.property_id
    warnings: list[str] = []
    rejected, accepted = [], 0
    tenants = db.scalars(scoped(M.Tenant, actor).where(M.Tenant.property_id == pid)).all()
    by_name = {t.name.lower(): t for t in tenants}
    by_suite = {t.suite.lower(): t for t in tenants if t.suite}

    def find_tenant(v: str):
        return by_name.get(v.lower()) or by_suite.get(v.lower())

    if batch.kind == "gl":
        existing = {(t.gl_account, t.txn_date, t.amount, (t.description or "").lower())
                    for t in db.scalars(scoped(M.GLTransaction, actor).where(
                        M.GLTransaction.property_id == pid))}
        seen = set()
        for src, v, errs in rows:
            if errs:
                rejected.append({"row": src, "errors": errs, "values": {k: str(x) for k, x in v.items()}})
                continue
            key = (v["gl_account"], v["txn_date"], v["amount"], v.get("description", "").lower())
            if key in seen or key in existing:
                warnings.append(f"Row {src}: possible duplicate of another transaction "
                                f"({v['gl_account']} {v['txn_date']} {v['amount']}). Kept and flagged.")
            seen.add(key)
            db.add(M.GLTransaction(
                organization_id=actor.org_id, property_id=pid, import_batch_id=batch.id,
                source_row=src, gl_account=v["gl_account"], account_name=v.get("account_name", ""),
                txn_date=v["txn_date"], amount=v["amount"], vendor=v.get("vendor", ""),
                description=v.get("description", "")))
            accepted += 1
        # Every new account gets a needs_review mapping so nothing is recoverable by default.
        accounts = {(v["gl_account"]) for _, v, e in rows if not e}
        mapped = set(db.scalars(select(M.ExpenseMapping.gl_account).where(
            M.ExpenseMapping.organization_id == actor.org_id, M.ExpenseMapping.property_id == pid)))
        for a in sorted(accounts - mapped):
            db.add(M.ExpenseMapping(organization_id=actor.org_id, property_id=pid, gl_account=a,
                                    status="needs_review"))
    elif batch.kind == "billings":
        for src, v, errs in rows:
            t = find_tenant(v.get("tenant", "")) if not errs else None
            if not errs and t is None:
                errs = [f"Tenant {v.get('tenant')!r} does not match any tenant name or suite"]
            if errs:
                rejected.append({"row": src, "errors": errs, "values": {k: str(x) for k, x in v.items()}})
                continue
            db.add(M.CamBilling(organization_id=actor.org_id, property_id=pid, tenant_id=t.id,
                                import_batch_id=batch.id, source_row=src, bill_date=v["bill_date"],
                                amount=v["amount"], description=v.get("description", "")))
            accepted += 1
    else:  # lease_rules
        accepted, rejected, w = _commit_rules(db, actor, pid, rows, find_tenant, sf.filename)
        warnings += w

    batch.status = "committed"
    batch.column_map = body.column_map
    batch.accepted_count = accepted
    batch.rejected_rows = rejected
    log(db, actor, "commit", batch, after={"accepted": accepted, "rejected": len(rejected)})
    db.commit()
    return CommitOut(batch=_batch_out(db, batch), warnings=warnings)


def _commit_rules(db, actor, pid, rows, find_tenant, filename):
    rejected, warnings, accepted = [], [], 0
    rules: dict[str, M.LeaseRule] = {r.ref: r for r in db.scalars(
        scoped(M.LeaseRule, actor).where(M.LeaseRule.property_id == pid))}
    for src, v, errs in rows:
        t = find_tenant(v.get("tenant", "")) if not errs else None
        if not errs and t is None:
            errs = [f"Tenant {v.get('tenant')!r} does not match any tenant name or suite"]
        ref = v.get("rule_ref", "")
        if not errs and ref in rules and rules[ref].status == "approved":
            errs = [f"Lease rule {ref} is approved. Edit it in the app to change it."]
        if errs:
            rejected.append({"row": src, "errors": errs, "values": {k: str(x) for k, x in v.items()}})
            continue
        lr = rules.get(ref)
        if lr is None:
            lr = M.LeaseRule(organization_id=actor.org_id, property_id=pid, ref=ref, status="draft",
                             admin_fee_pools=[], unsupported_terms=[])
            db.add(lr)
            db.flush()
            rules[ref] = lr
        if v.get("admin_fee_pct") is not None:
            lr.admin_fee_pct = v["admin_fee_pct"]
            lr.admin_fee_pools = I.split_list(v.get("admin_fee_pools"))
            lr.admin_fee_order = v.get("admin_fee_order") or None
        terms = I.split_list(v.get("unsupported_terms"))
        if terms:
            lr.unsupported_terms = sorted(set(lr.unsupported_terms or []) | set(terms))
        lr.source_ref = v.get("source_ref") or lr.source_ref or f"{filename} row {src}"
        pool = v["pool"]
        a = db.scalar(select(M.AllocationRule).where(M.AllocationRule.lease_rule_id == lr.id,
                                                     M.AllocationRule.pool == pool))
        if a is None:
            a = M.AllocationRule(organization_id=actor.org_id, lease_rule_id=lr.id, pool=pool)
            db.add(a)
        a.method = v["method"]
        a.denominator_sqft = v.get("denominator_sqft")
        a.fixed_pct = v.get("fixed_pct")
        a.excluded_categories = I.split_list(v.get("excluded_categories"))
        a.base_year_amount = v.get("base_year_amount")
        a.gross_up_enabled = v.get("gross_up_target") is not None or v.get("gross_up_actual") is not None
        a.gross_up_target = v.get("gross_up_target")
        a.gross_up_actual = v.get("gross_up_actual")
        a.cap_kind = v.get("cap_kind") or None
        a.cap_pct = v.get("cap_pct")
        a.cap_prior_year = v.get("cap_prior_year")
        if t.lease_rule_id not in (None, lr.id):
            warnings.append(f"Row {src}: {t.name} was linked to another rule. Relinked to {ref}.")
        t.lease_rule_id = lr.id
        accepted += 1
    warnings.append("Imported lease rules are drafts. Approve each one before it is used in an audit.")
    return accepted, rejected, warnings


@router.get("/properties/{pid}/imports", response_model=list[ImportOut])
def history(pid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    batches = db.scalars(scoped(M.ImportBatch, actor).where(M.ImportBatch.property_id == pid)
                         .order_by(M.ImportBatch.created_at.desc())).all()
    return [_batch_out(db, b) for b in batches]


@router.get("/properties/{pid}/gl-transactions", response_model=list[GLTransactionOut])
def gl_transactions(pid: uuid.UUID, gl_account: str | None = None,
                    actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    q = scoped(M.GLTransaction, actor).where(M.GLTransaction.property_id == pid)
    if gl_account:
        q = q.where(M.GLTransaction.gl_account == gl_account)
    return db.scalars(q.order_by(M.GLTransaction.gl_account, M.GLTransaction.txn_date)).all()


@router.post("/gl-transactions/{tid}/exclude", response_model=GLTransactionOut)
def exclude_transaction(tid: uuid.UUID, body: ReviewIn, actor: Actor = Depends(current_actor),
                        db: Session = Depends(get_session)):
    return _set_excluded(tid, True, body, actor, db)


@router.post("/gl-transactions/{tid}/include", response_model=GLTransactionOut)
def include_transaction(tid: uuid.UUID, body: ReviewIn, actor: Actor = Depends(current_actor),
                        db: Session = Depends(get_session)):
    return _set_excluded(tid, False, body, actor, db)


def _set_excluded(tid, value, body, actor, db):
    t = get_owned(db, M.GLTransaction, tid, actor)
    t.excluded_by_review = value
    db.add(M.ReviewDecision(organization_id=actor.org_id, property_id=t.property_id,
                            target_type="gl_transaction", target_id=str(t.id),
                            decision="exclude" if value else "include", note=body.note,
                            reviewer_id=actor.user_id))
    log(db, actor, "exclude" if value else "include", t, after={"note": body.note})
    db.commit()
    return t


@router.get("/properties/{pid}/gl-accounts", response_model=list[GLAccountOut])
def gl_accounts(pid: uuid.UUID, actor: Actor = Depends(current_actor),
                db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    agg = db.execute(select(M.GLTransaction.gl_account, func.max(M.GLTransaction.account_name),
                            func.count(), func.sum(M.GLTransaction.amount))
                     .where(M.GLTransaction.organization_id == actor.org_id,
                            M.GLTransaction.property_id == pid)
                     .group_by(M.GLTransaction.gl_account).order_by(M.GLTransaction.gl_account)).all()
    maps = {m.gl_account: m for m in db.scalars(scoped(M.ExpenseMapping, actor).where(
        M.ExpenseMapping.property_id == pid))}
    users = {u.id: u.name for u in db.scalars(scoped(M.User, actor))}
    out = []
    for acct, name, n, total in agg:
        m = maps.get(acct)
        out.append(GLAccountOut(
            gl_account=acct, account_name=name or "", transaction_count=n, total=total,
            mapping_id=m.id if m else None, category_code=m.category_code if m else None,
            status=m.status if m else "needs_review", explanation=m.explanation if m else "",
            source_ref=m.source_ref if m else "",
            reviewer=users.get(m.reviewer_id) if m and m.reviewer_id else None,
            reviewed_at=m.reviewed_at if m else None))
    return out


MAP_FIELDS = ["category_code", "status", "explanation", "source_ref"]


@router.put("/properties/{pid}/mappings/{gl_account}", response_model=GLAccountOut)
def set_mapping(pid: uuid.UUID, gl_account: str, body: MappingIn,
                actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    if body.status == "recoverable" and not body.category_code:
        raise HTTPException(422, "A recoverable mapping needs a category.")
    if body.status != "needs_review" and not body.explanation:
        raise HTTPException(422, "Explain the decision. Recoverability is never inferred.")
    if body.category_code and not db.scalar(scoped(M.ExpenseCategory, actor).where(
            M.ExpenseCategory.property_id == pid, M.ExpenseCategory.code == body.category_code)):
        raise HTTPException(422, f"Unknown category {body.category_code}.")
    m = db.scalar(scoped(M.ExpenseMapping, actor).where(M.ExpenseMapping.property_id == pid,
                                                         M.ExpenseMapping.gl_account == gl_account))
    if m is None:
        m = M.ExpenseMapping(organization_id=actor.org_id, property_id=pid, gl_account=gl_account)
        db.add(m)
        db.flush()
        before = None
    else:
        before = snapshot(m, MAP_FIELDS)
    m.category_code = body.category_code
    m.status = body.status
    m.explanation = body.explanation
    m.source_ref = body.source_ref
    m.reviewer_id = actor.user_id
    m.reviewed_at = datetime.now(timezone.utc)
    db.add(M.ReviewDecision(organization_id=actor.org_id, property_id=pid,
                            target_type="expense_mapping", target_id=gl_account,
                            decision=body.status, note=body.explanation, reviewer_id=actor.user_id))
    log(db, actor, "review", m, before, snapshot(m, MAP_FIELDS))
    db.commit()
    return next(a for a in gl_accounts(pid, actor, db) if a.gl_account == gl_account) \
        if db.scalar(select(func.count()).select_from(M.GLTransaction).where(
            M.GLTransaction.property_id == pid, M.GLTransaction.gl_account == gl_account)) else \
        GLAccountOut(gl_account=gl_account, account_name="", transaction_count=0, total=0,
                     mapping_id=m.id, category_code=m.category_code, status=m.status,
                     explanation=m.explanation, source_ref=m.source_ref, reviewer=actor.name,
                     reviewed_at=m.reviewed_at)
