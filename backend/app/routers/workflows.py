"""Workflows API: definitions, versions, files, runs, approvals and artifacts.

Every query is organization-scoped. Runs execute in a background task after the response is
sent; clients poll GET /workflow-runs/{id}. See docs/WORKFLOWS.md for execution semantics.
"""

from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models as M
from ..auth import Actor, current_actor
from ..config import settings
from ..db import SessionLocal, get_session
from ..scoping import get_owned, idempotency_key, log, scoped
from ..services.imports import sha256
from ..workflows import engine, graph
from ..workflows import templates as T
from ..workflows.nodes import REGISTRY
from ..workflows.table import NodeError, Table, list_sheets, read_spreadsheet, sniff_format

router = APIRouter()
logger = logging.getLogger("veyra.workflows")

CATEGORIES = ("data_quality", "cam", "lease", "billing", "custom")


# ------------------------------------------------------------------------------------- schemas


class DefinitionIn(BaseModel):
    nodes: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    edges: list[dict[str, Any]] = Field(default_factory=list, max_length=500)


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    category: str = "custom"
    template_key: str | None = None
    property_id: uuid.UUID | None = None
    definition: DefinitionIn | None = None


class WorkflowUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    category: str | None = None
    status: Literal["draft", "active", "archived"] | None = None
    definition: DefinitionIn | None = None


class RunCreate(BaseModel):
    inputs: dict[str, str] = Field(default_factory=dict)


class Decision(BaseModel):
    decision: Literal["approve", "reject"]
    note: str = Field(min_length=3, max_length=2000)


# ------------------------------------------------------------------------------------- helpers


def _user_names(db: Session, actor: Actor) -> dict[uuid.UUID, str]:
    return {u.id: u.name for u in db.scalars(select(M.User).where(M.User.organization_id == actor.org_id))}


def _version(db: Session, wf: M.Workflow) -> M.WorkflowVersion:
    v = db.get(M.WorkflowVersion, wf.current_version_id) if wf.current_version_id else None
    if v is None:
        raise HTTPException(409, "This workflow has no saved version.")
    return v


def _save_version(db: Session, actor: Actor, wf: M.Workflow, defn_raw: dict[str, Any]) -> M.WorkflowVersion:
    defn = graph.normalize(defn_raw)
    h = graph.definition_hash(defn)
    current = db.get(M.WorkflowVersion, wf.current_version_id) if wf.current_version_id else None
    if current is not None and current.definition_hash == h and current.definition == defn:
        return current  # nothing changed, layout included
    number = (
        db.scalar(select(func.max(M.WorkflowVersion.number)).where(M.WorkflowVersion.workflow_id == wf.id)) or 0
    ) + 1
    v = M.WorkflowVersion(
        organization_id=actor.org_id,
        workflow_id=wf.id,
        number=number,
        definition=defn,
        definition_hash=h,
        created_by=actor.user_id,
    )
    db.add(v)
    db.flush()
    for n in defn["nodes"]:
        db.add(
            M.WorkflowNode(
                organization_id=actor.org_id,
                version_id=v.id,
                node_key=n["id"],
                type=n["type"],
                label=n["label"],
                config=n["config"],
                position=n["position"],
            )
        )
    for e in defn["edges"]:
        db.add(
            M.WorkflowEdge(
                organization_id=actor.org_id,
                version_id=v.id,
                edge_key=e["id"],
                source=e["source"],
                source_port=e["source_port"],
                target=e["target"],
                target_port=e["target_port"],
            )
        )
    wf.current_version_id = v.id
    return v


def _sync_templates(db: Session) -> None:
    existing = {t.key: t for t in db.scalars(select(M.WorkflowTemplate))}
    changed = False
    for t in T.TEMPLATES:
        row = existing.get(t["key"])
        if row is None:
            db.add(
                M.WorkflowTemplate(
                    key=t["key"],
                    name=t["name"],
                    description=t["description"],
                    category=t["category"],
                    version=t["version"],
                    definition=t["definition"],
                )
            )
            changed = True
        elif row.version != t["version"] or row.definition != t["definition"] or row.name != t["name"]:
            row.name, row.description, row.category, row.version, row.definition = (
                t["name"],
                t["description"],
                t["category"],
                t["version"],
                t["definition"],
            )
            changed = True
    if changed:
        try:
            db.commit()
        except IntegrityError:  # another request synced first
            db.rollback()


def _run_brief(
    r: M.WorkflowRun,
    names: dict[uuid.UUID, str],
    wf_names: dict[uuid.UUID, str] | None = None,
    version_numbers: dict[uuid.UUID, int] | None = None,
) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "workflow_id": str(r.workflow_id),
        "workflow_name": (wf_names or {}).get(r.workflow_id, ""),
        "version": (version_numbers or {}).get(r.version_id),
        "status": r.status,
        "created_at": r.created_at,
        "started_at": r.started_at,
        "finished_at": r.finished_at,
        "error": r.error,
        "summary": r.summary or {},
        "created_by": names.get(r.created_by, "") if r.created_by else "",
        "retry_of": str(r.retry_of) if r.retry_of else None,
    }


def _workflow_out(
    db: Session, wf: M.Workflow, names: dict[uuid.UUID, str], last: M.WorkflowRun | None, steps: int
) -> dict[str, Any]:
    return {
        "id": str(wf.id),
        "name": wf.name,
        "description": wf.description,
        "category": wf.category,
        "status": wf.status,
        "template_key": wf.template_key,
        "owner": names.get(wf.owner_id, "") if wf.owner_id else "",
        "steps": steps,
        "created_at": wf.created_at,
        "updated_at": wf.updated_at,
        "last_run": None
        if last is None
        else {"id": str(last.id), "status": last.status, "created_at": last.created_at},
    }


# ------------------------------------------------------------------------------ catalog/templates


@router.get("/workflow-nodes")
def list_nodes(actor: Actor = Depends(current_actor)) -> list[dict[str, Any]]:
    return [s.public() for s in REGISTRY.values()]


@router.get("/workflow-templates")
def list_templates(db: Session = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[dict[str, Any]]:
    _sync_templates(db)
    out = []
    for t in db.scalars(select(M.WorkflowTemplate).order_by(M.WorkflowTemplate.name)):
        types = [n["type"] for n in t.definition["nodes"]]
        out.append(
            {
                "key": t.key,
                "name": t.name,
                "description": t.description,
                "category": t.category,
                "version": t.version,
                "steps": len(types),
                "needs_property": T.needs_property(t.definition),
                "inputs": [
                    n["config"].get("input_label") or n["label"]
                    for n in t.definition["nodes"]
                    if n["type"] == "spreadsheet_upload"
                ],
                "node_types": types,
            }
        )
    order = {t["key"]: i for i, t in enumerate(T.TEMPLATES)}
    return sorted(out, key=lambda t: order.get(t["key"], 99))


# ------------------------------------------------------------------------------------ workflows


@router.get("/workflows")
def list_workflows(
    category: str | None = None,
    status: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> list[dict[str, Any]]:
    stmt = scoped(M.Workflow, actor)
    if category:
        stmt = stmt.where(M.Workflow.category == category)
    if status:
        stmt = stmt.where(M.Workflow.status == status)
    else:
        stmt = stmt.where(M.Workflow.status != "archived")
    if q:
        stmt = stmt.where(M.Workflow.name.ilike(f"%{q.strip()[:100]}%"))
    wfs = db.scalars(stmt.order_by(M.Workflow.updated_at.desc())).all()
    names = _user_names(db, actor)
    ids = [w.id for w in wfs]
    last: dict[uuid.UUID, M.WorkflowRun] = {}
    if ids:
        for r in db.scalars(
            scoped(M.WorkflowRun, actor).where(M.WorkflowRun.workflow_id.in_(ids)).order_by(M.WorkflowRun.created_at)
        ):
            last[r.workflow_id] = r
    counts: dict[uuid.UUID, int] = defaultdict(int)
    vids = [w.current_version_id for w in wfs if w.current_version_id]
    if vids:
        for vid, n in db.execute(
            select(M.WorkflowNode.version_id, func.count())
            .where(M.WorkflowNode.version_id.in_(vids))
            .group_by(M.WorkflowNode.version_id)
        ):
            counts[vid] = n
    return [
        _workflow_out(db, w, names, last.get(w.id), counts.get(w.current_version_id, 0) if w.current_version_id else 0)
        for w in wfs
    ]


@router.post("/workflows", status_code=201)
def create_workflow(
    body: WorkflowCreate, db: Session = Depends(get_session), actor: Actor = Depends(current_actor)
) -> dict[str, Any]:
    if body.category not in CATEGORIES:
        raise HTTPException(422, f"Category must be one of {', '.join(CATEGORIES)}.")
    if body.template_key:
        if body.template_key not in T.BY_KEY:
            raise HTTPException(404, "Template not found")
        tdef = T.BY_KEY[body.template_key]["definition"]
        if T.needs_property(tdef):
            if body.property_id is None:
                raise HTTPException(422, "This template reads Veyra data. Choose a property.")
            get_owned(db, M.Property, body.property_id, actor)
        defn = T.instantiate(body.template_key, str(body.property_id) if body.property_id else None)
        category = T.BY_KEY[body.template_key]["category"] if body.category == "custom" else body.category
    else:
        defn = body.definition.model_dump() if body.definition else {"nodes": [], "edges": []}
        category = body.category
    wf = M.Workflow(
        organization_id=actor.org_id,
        name=body.name.strip(),
        description=body.description,
        category=category,
        template_key=body.template_key,
        owner_id=actor.user_id,
        status="active" if body.template_key else "draft",
    )
    db.add(wf)
    db.flush()
    _save_version(db, actor, wf, defn)
    log(db, actor, "workflow_create", wf, after={"name": wf.name, "template": body.template_key})
    db.commit()
    return get_workflow(wf.id, db, actor)


@router.get("/workflows/{wid}")
def get_workflow(
    wid: uuid.UUID, db: Session = Depends(get_session), actor: Actor = Depends(current_actor)
) -> dict[str, Any]:
    wf = get_owned(db, M.Workflow, wid, actor)
    v = _version(db, wf)
    names = _user_names(db, actor)
    last = db.scalar(
        scoped(M.WorkflowRun, actor)
        .where(M.WorkflowRun.workflow_id == wf.id)
        .order_by(M.WorkflowRun.created_at.desc())
        .limit(1)
    )
    versions = db.scalars(
        select(M.WorkflowVersion)
        .where(M.WorkflowVersion.workflow_id == wf.id)
        .order_by(M.WorkflowVersion.number.desc())
    ).all()
    out = _workflow_out(db, wf, names, last, len(v.definition["nodes"]))
    out.update(
        {
            "version": {"id": str(v.id), "number": v.number, "hash": v.definition_hash, "created_at": v.created_at},
            "definition": v.definition,
            "errors": graph.validate(v.definition),
            "versions": [
                {
                    "id": str(x.id),
                    "number": x.number,
                    "created_at": x.created_at,
                    "created_by": names.get(x.created_by, "") if x.created_by else "",
                }
                for x in versions
            ],
        }
    )
    return out


@router.put("/workflows/{wid}")
def update_workflow(
    wid: uuid.UUID, body: WorkflowUpdate, db: Session = Depends(get_session), actor: Actor = Depends(current_actor)
) -> dict[str, Any]:
    wf = get_owned(db, M.Workflow, wid, actor)
    before = {"name": wf.name, "status": wf.status, "version": str(wf.current_version_id)}
    if body.name is not None:
        wf.name = body.name.strip()
    if body.description is not None:
        wf.description = body.description
    if body.category is not None:
        if body.category not in CATEGORIES:
            raise HTTPException(422, f"Category must be one of {', '.join(CATEGORIES)}.")
        wf.category = body.category
    if body.status is not None:
        wf.status = body.status
    if body.definition is not None:
        _save_version(db, actor, wf, body.definition.model_dump())
    wf.updated_at = datetime.now().astimezone()
    log(
        db,
        actor,
        "workflow_update",
        wf,
        before=before,
        after={"name": wf.name, "status": wf.status, "version": str(wf.current_version_id)},
    )
    db.commit()
    return get_workflow(wf.id, db, actor)


@router.post("/workflows/validate")
def validate_definition(body: DefinitionIn, actor: Actor = Depends(current_actor)) -> dict[str, Any]:
    return {"errors": graph.validate(graph.normalize(body.model_dump()))}


@router.get("/workflows/{wid}/versions/{number}")
def get_version(
    wid: uuid.UUID, number: int, db: Session = Depends(get_session), actor: Actor = Depends(current_actor)
) -> dict[str, Any]:
    wf = get_owned(db, M.Workflow, wid, actor)
    v = db.scalar(
        select(M.WorkflowVersion).where(M.WorkflowVersion.workflow_id == wf.id, M.WorkflowVersion.number == number)
    )
    if v is None:
        raise HTTPException(404, "Version not found")
    return {
        "id": str(v.id),
        "number": v.number,
        "hash": v.definition_hash,
        "definition": v.definition,
        "created_at": v.created_at,
    }


# ---------------------------------------------------------------------------------------- files


@router.post("/workflow-files", status_code=201)
async def upload_file(
    file: UploadFile = File(...), db: Session = Depends(get_session), actor: Actor = Depends(current_actor)
) -> dict[str, Any]:
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(413, f"Files are limited to {settings.max_upload_bytes // (1024 * 1024)} MB.")
    if not content:
        raise HTTPException(422, "The file is empty.")
    name = (file.filename or "upload").replace("\\", "/").split("/")[-1][:200]
    try:
        fmt = sniff_format(name, content)
        sheets = list_sheets(name, content)
        preview = read_spreadsheet(name, content).preview(20)
    except NodeError as e:
        raise HTTPException(422, str(e)) from e
    sf = M.SourceFile(
        organization_id=actor.org_id,
        filename=name,
        content_type="text/csv"
        if fmt == "csv"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sha256=sha256(content),
        size_bytes=len(content),
        content=content,
        uploaded_by=actor.user_id,
    )
    db.add(sf)
    db.flush()
    log(db, actor, "workflow_file_upload", sf, after={"filename": name, "sha256": sf.sha256})
    db.commit()
    return {
        "id": str(sf.id),
        "filename": name,
        "size_bytes": sf.size_bytes,
        "sha256": sf.sha256,
        "sheets": sheets,
        "preview": preview,
    }


@router.get("/workflow-files/{fid}/preview")
def preview_file(
    fid: uuid.UUID,
    sheet: str = "",
    header_row: int = Query(1, ge=1, le=100),
    db: Session = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> dict[str, Any]:
    sf = get_owned(db, M.SourceFile, fid, actor)
    try:
        return read_spreadsheet(sf.filename, sf.content, sheet=sheet, header_row=header_row).preview(20)
    except NodeError as e:
        raise HTTPException(422, str(e)) from e


# ----------------------------------------------------------------------------------------- runs


def _start(background: BackgroundTasks, run_id: uuid.UUID) -> None:
    background.add_task(engine.execute, SessionLocal, run_id)


@router.post("/workflows/{wid}/runs", status_code=201)
def create_run(
    wid: uuid.UUID,
    body: RunCreate,
    background: BackgroundTasks,
    db: Session = Depends(get_session),
    actor: Actor = Depends(current_actor),
    idem: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    wf = get_owned(db, M.Workflow, wid, actor)
    if wf.status == "archived":
        raise HTTPException(409, "Archived workflows cannot run. Restore it first.")
    key = idempotency_key(idem)
    if key:
        prior = db.scalar(scoped(M.WorkflowRun, actor).where(M.WorkflowRun.idempotency_key == key))
        if prior is not None:
            return get_run(prior.id, db, actor)
    v = _version(db, wf)
    try:
        run = engine.create_run(db, actor.org_id, actor.user_id, wf, v, body.inputs, key)
    except NodeError as e:
        db.rollback()
        raise HTTPException(422, str(e)) from e
    log(db, actor, "workflow_run", run, after={"workflow": str(wf.id), "version": v.number, "inputs": run.inputs})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        prior = db.scalar(scoped(M.WorkflowRun, actor).where(M.WorkflowRun.idempotency_key == key))
        if prior is None:
            raise
        return get_run(prior.id, db, actor)
    _start(background, run.id)
    return get_run(run.id, db, actor)


@router.get("/workflow-runs")
def list_runs(
    workflow_id: uuid.UUID | None = None,
    status: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> list[dict[str, Any]]:
    stmt = scoped(M.WorkflowRun, actor)
    if workflow_id:
        stmt = stmt.where(M.WorkflowRun.workflow_id == workflow_id)
    if status:
        stmt = stmt.where(M.WorkflowRun.status == status)
    runs = db.scalars(stmt.order_by(M.WorkflowRun.created_at.desc()).limit(limit)).all()
    names = _user_names(db, actor)
    wf_names = {w.id: w.name for w in db.scalars(scoped(M.Workflow, actor))}
    vnums = (
        {
            v.id: v.number
            for v in db.scalars(select(M.WorkflowVersion).where(M.WorkflowVersion.id.in_([r.version_id for r in runs])))
        }
        if runs
        else {}
    )
    return [_run_brief(r, names, wf_names, vnums) for r in runs]


@router.get("/workflow-runs/{rid}")
def get_run(
    rid: uuid.UUID, db: Session = Depends(get_session), actor: Actor = Depends(current_actor)
) -> dict[str, Any]:
    run = get_owned(db, M.WorkflowRun, rid, actor)
    db.refresh(run)
    wf = db.get(M.Workflow, run.workflow_id)
    v = db.get(M.WorkflowVersion, run.version_id)
    assert wf is not None and v is not None
    names = _user_names(db, actor)
    out = _run_brief(run, names, {wf.id: wf.name}, {v.id: v.number})
    steps = db.scalars(
        select(M.WorkflowStepRun).where(M.WorkflowStepRun.run_id == run.id).order_by(M.WorkflowStepRun.position)
    ).all()
    approvals = {
        a.step_run_id: a for a in db.scalars(select(M.WorkflowApproval).where(M.WorkflowApproval.run_id == run.id))
    }
    arts = db.scalars(
        select(M.WorkflowArtifact)
        .where(M.WorkflowArtifact.run_id == run.id, M.WorkflowArtifact.kind == "output")
        .order_by(M.WorkflowArtifact.created_at)
    ).all()
    files = []
    labels = {n["id"]: n["label"] for n in v.definition["nodes"]}
    for nid, fid in (run.inputs or {}).items():
        sf = db.get(M.SourceFile, uuid.UUID(fid))
        if sf:
            files.append(
                {
                    "node": nid,
                    "label": labels.get(nid, nid),
                    "file_id": fid,
                    "filename": sf.filename,
                    "sha256": sf.sha256,
                    "size_bytes": sf.size_bytes,
                }
            )
    out.update(
        {
            "definition": v.definition,
            "definition_hash": v.definition_hash,
            "inputs": files,
            "cancel_requested": run.cancel_requested,
            "steps": [
                {
                    "id": str(s.id),
                    "node_key": s.node_key,
                    "node_type": s.node_type,
                    "label": s.label,
                    "status": s.status,
                    "attempts": s.attempts,
                    "started_at": s.started_at,
                    "finished_at": s.finished_at,
                    "logs": s.logs,
                    "outputs": s.outputs,
                    "issues": s.issues,
                    "error": s.error,
                    "approval": None
                    if s.id not in approvals
                    else {
                        "id": str(approvals[s.id].id),
                        "status": approvals[s.id].status,
                        "instructions": approvals[s.id].instructions,
                        "note": approvals[s.id].note,
                        "decided_by": names.get(approvals[s.id].decided_by, "") if approvals[s.id].decided_by else "",
                        "decided_at": approvals[s.id].decided_at,
                    },
                }
                for s in steps
            ],
            "artifacts": [
                {
                    "id": str(a.id),
                    "name": a.name,
                    "content_type": a.content_type,
                    "size_bytes": a.size_bytes,
                    "sha256": a.sha256,
                    "step": next((s.label for s in steps if s.id == a.step_run_id), ""),
                }
                for a in arts
            ],
        }
    )
    return out


@router.get("/workflow-runs/{rid}/steps/{node_key}/data")
def step_data(
    rid: uuid.UUID,
    node_key: str,
    port: str = "out",
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> dict[str, Any]:
    run = get_owned(db, M.WorkflowRun, rid, actor)
    step = db.scalar(
        select(M.WorkflowStepRun).where(M.WorkflowStepRun.run_id == run.id, M.WorkflowStepRun.node_key == node_key)
    )
    if step is None:
        raise HTTPException(404, "Step not found")
    art = db.scalar(
        select(M.WorkflowArtifact).where(
            M.WorkflowArtifact.step_run_id == step.id,
            M.WorkflowArtifact.kind == "step_data",
            M.WorkflowArtifact.name == port,
        )
    )
    if art is None:
        raise HTTPException(404, "This step has no data for that output.")
    t = Table.from_json_bytes(art.content)
    rows = t.rows[offset : offset + limit]
    return {
        "columns": t.columns,
        "rows": [[r.get(c, "") for c in t.columns] for r in rows],
        "source_rows": t.source_rows[offset : offset + limit],
        "row_count": len(t),
        "offset": offset,
    }


@router.post("/workflow-runs/{rid}/cancel")
def cancel_run(
    rid: uuid.UUID, db: Session = Depends(get_session), actor: Actor = Depends(current_actor)
) -> dict[str, Any]:
    run = get_owned(db, M.WorkflowRun, rid, actor)
    try:
        engine.request_cancel(db, run)
    except NodeError as e:
        raise HTTPException(409, str(e)) from e
    log(db, actor, "workflow_cancel", run)
    db.commit()
    return get_run(run.id, db, actor)


@router.post("/workflow-runs/{rid}/retry", status_code=201)
def retry_run(
    rid: uuid.UUID,
    background: BackgroundTasks,
    db: Session = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> dict[str, Any]:
    """Run the same version again with the same input files. Workflows never write financial
    records, so a retry can only produce a new set of run artifacts."""
    old = get_owned(db, M.WorkflowRun, rid, actor)
    if old.status not in ("failed", "cancelled", "rejected", "completed"):
        raise HTTPException(409, "Only finished runs can be retried.")
    wf = get_owned(db, M.Workflow, old.workflow_id, actor)
    v = db.get(M.WorkflowVersion, old.version_id)
    assert v is not None
    try:
        run = engine.create_run(db, actor.org_id, actor.user_id, wf, v, dict(old.inputs or {}), retry_of=old.id)
    except NodeError as e:
        db.rollback()
        raise HTTPException(422, str(e)) from e
    log(db, actor, "workflow_retry", run, after={"retry_of": str(old.id)})
    db.commit()
    _start(background, run.id)
    return get_run(run.id, db, actor)


@router.post("/workflow-approvals/{aid}")
def decide_approval(
    aid: uuid.UUID,
    body: Decision,
    background: BackgroundTasks,
    db: Session = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> dict[str, Any]:
    approval = get_owned(db, M.WorkflowApproval, aid, actor)
    try:
        run = engine.decide(db, approval, actor.user_id, body.decision, body.note.strip())
    except NodeError as e:
        raise HTTPException(409, str(e)) from e
    log(db, actor, f"workflow_{body.decision}", approval, after={"note": body.note})
    db.commit()
    if body.decision == "approve":
        _start(background, run.id)
    return get_run(run.id, db, actor)


@router.get("/workflow-artifacts/{aid}/download")
def download_artifact(
    aid: uuid.UUID, db: Session = Depends(get_session), actor: Actor = Depends(current_actor)
) -> Response:
    art = get_owned(db, M.WorkflowArtifact, aid, actor)
    if art.kind != "output":
        raise HTTPException(404, "WorkflowArtifact not found")
    safe = "".join(ch for ch in art.name if ch.isalnum() or ch in "-_ .") or "output"
    return Response(
        content=art.content,
        media_type=art.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{safe}"',
            "X-Content-Type-Options": "nosniff",
            "X-Content-SHA256": art.sha256,
        },
    )
