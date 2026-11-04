"""Workflow execution.

A run is executed step by step in dependency order. After every step the step's status, logs,
issues, output preview and full output data are committed, so a run can be inspected while it
executes and resumed after an approval gate without recomputing earlier steps.

Rules (see docs/WORKFLOWS.md):
- A run is claimed atomically (queued -> running), so it is never executed twice in parallel.
- The first failed step fails the run; every later step is marked skipped. A failed step can
  never leave the run marked completed.
- Cancellation is checked before each step.
- Approval gates pause the run; approve resumes it, reject ends it.
- Unexpected errors are retried up to the node's `retries` setting. Configuration and input
  errors (NodeError) are not retried: the same input would fail the same way.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .. import models as M
from . import graph
from .nodes import REGISTRY, Context, NodeResult
from .table import NodeError, Table

logger = logging.getLogger("veyra.workflows")

TERMINAL = {"completed", "failed", "cancelled", "rejected"}
MAX_RETRIES = 2


def _now() -> datetime:
    return datetime.now(UTC)


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def create_run(
    db: Session,
    org_id: uuid.UUID,
    user_id: uuid.UUID | None,
    wf: M.Workflow,
    version: M.WorkflowVersion,
    inputs: dict[str, str],
    idempotency_key: str | None = None,
    retry_of: uuid.UUID | None = None,
) -> M.WorkflowRun:
    defn = version.definition
    errors = graph.validate(defn)
    if errors:
        raise NodeError("; ".join(e["message"] for e in errors[:5]))
    clean: dict[str, str] = {}
    for n in defn["nodes"]:
        if n["type"] != "spreadsheet_upload":
            continue
        raw = inputs.get(n["id"])
        if not raw:
            raise NodeError(f"Upload a file for {n['label']!r}.")
        try:
            fid = uuid.UUID(str(raw))
        except ValueError as exc:
            raise NodeError(f"Invalid file reference for {n['label']!r}.") from exc
        sf = db.get(M.SourceFile, fid)
        if sf is None or sf.organization_id != org_id:
            raise NodeError(f"The file for {n['label']!r} was not found.")
        clean[n["id"]] = str(fid)
    order = graph.order(defn) or []
    by_id = {n["id"]: n for n in defn["nodes"]}
    run = M.WorkflowRun(
        organization_id=org_id,
        workflow_id=wf.id,
        version_id=version.id,
        status="queued",
        inputs=clean,
        idempotency_key=idempotency_key,
        retry_of=retry_of,
        created_by=user_id,
    )
    db.add(run)
    db.flush()
    for i, key in enumerate(order):
        n = by_id[key]
        db.add(
            M.WorkflowStepRun(
                organization_id=org_id, run_id=run.id, node_key=key, node_type=n["type"], label=n["label"], position=i
            )
        )
    db.flush()
    return run


def execute(session_factory: Any, run_id: uuid.UUID) -> None:
    """Run (or resume) a queued run to completion, failure, cancellation or the next approval gate."""
    with session_factory() as db:
        claimed = db.execute(
            update(M.WorkflowRun)
            .where(M.WorkflowRun.id == run_id, M.WorkflowRun.status == "queued")
            .values(status="running", started_at=M.WorkflowRun.started_at)
            .returning(M.WorkflowRun.id)
        ).first()
        db.commit()
        if not claimed:
            return  # already running, finished, or waiting
        run = db.get(M.WorkflowRun, run_id)
        assert run is not None
        if run.started_at is None:
            run.started_at = _now()
            db.commit()
        try:
            _execute(db, run)
        except Exception:
            logger.exception("workflow run crashed", extra={"run_id": str(run_id)})
            db.rollback()
            run = db.get(M.WorkflowRun, run_id)
            if run is not None and run.status not in TERMINAL:
                run.status = "failed"
                run.error = (
                    "The run stopped unexpectedly. Retry it; if it fails again, contact support with the run ID."
                )
                run.finished_at = _now()
                for s in db.scalars(select(M.WorkflowStepRun).where(M.WorkflowStepRun.run_id == run_id)):
                    if s.status in ("pending", "running"):
                        s.status = "skipped" if s.status == "pending" else "failed"
                db.commit()


def _load_output(db: Session, step: M.WorkflowStepRun, port: str) -> Table:
    art = db.scalar(
        select(M.WorkflowArtifact).where(
            M.WorkflowArtifact.step_run_id == step.id,
            M.WorkflowArtifact.kind == "step_data",
            M.WorkflowArtifact.name == port,
        )
    )
    if art is None:
        raise NodeError(f"Output {port!r} of {step.label!r} is not available.")
    return Table.from_json_bytes(art.content)


def _execute(db: Session, run: M.WorkflowRun) -> None:
    version = db.get(M.WorkflowVersion, run.version_id)
    wf = db.get(M.Workflow, run.workflow_id)
    assert version is not None and wf is not None
    defn = version.definition
    by_id = {n["id"]: n for n in defn["nodes"]}
    steps = {s.node_key: s for s in db.scalars(select(M.WorkflowStepRun).where(M.WorkflowStepRun.run_id == run.id))}
    cache: dict[tuple[str, str], Table] = {}
    inputs_files = {k: uuid.UUID(v) for k, v in (run.inputs or {}).items()}

    def upstream(node_id: str, port: str) -> Table:
        key = (node_id, port)
        if key not in cache:
            cache[key] = _load_output(db, steps[node_id], port)
        return cache[key]

    def provenance() -> list[str]:
        lines = [
            f"{wf.name} (version {version.number})",
            f"Run {run.id}",
            f"Executed {_now().strftime('%Y-%m-%d %H:%M UTC')} by Veyra Workflows. Definition "
            f"{version.definition_hash[:12]}.",
            "Provisional working output for accountant review. Not a final year-end reconciliation.",
            "",
            "Inputs",
        ]
        for nid, fid in inputs_files.items():
            sf = db.get(M.SourceFile, fid)
            if sf:
                lines.append(f"  {by_id.get(nid, {}).get('label', nid)}: {sf.filename}  sha256 {sf.sha256}")
        if not inputs_files:
            lines.append("  Veyra property data (read only)")
        return lines

    for key in graph.order(defn) or []:
        step = steps[key]
        node = by_id[key]
        if step.status == "completed":
            continue
        db.refresh(run)
        if run.cancel_requested:
            _finish(db, run, steps, "cancelled", "Cancelled by a reviewer.")
            return
        spec = REGISTRY[node["type"]]
        if node["type"] == "approval_gate":
            approval = db.scalar(select(M.WorkflowApproval).where(M.WorkflowApproval.step_run_id == step.id))
            if approval is None:
                db.add(
                    M.WorkflowApproval(
                        organization_id=run.organization_id,
                        run_id=run.id,
                        step_run_id=step.id,
                        instructions=str(node["config"].get("instructions") or ""),
                    )
                )
                step.status = "waiting_approval"
                step.logs = [*step.logs, f"{_now().isoformat(timespec='seconds')} Waiting for approval."]
                run.status = "waiting_approval"
                db.commit()
                return
            if approval.status == "pending":
                run.status = "waiting_approval"
                db.commit()
                return
            # approved: fall through and run the gate (a pass-through); rejected runs never reach here

        inputs: dict[str, Any] = {}
        for p in spec.inputs:
            edges = [e for e in defn["edges"] if e["target"] == key and e["target_port"] == p.name]
            if p.multi:
                inputs[p.name] = [
                    (
                        by_id[e["source"]]["label"] + ("" if e["source_port"] == "out" else f" - {e['source_port']}"),
                        upstream(e["source"], e["source_port"]),
                    )
                    for e in edges
                ]
            elif edges:
                inputs[p.name] = upstream(edges[0]["source"], edges[0]["source_port"])

        anc = graph.ancestors(defn, key)

        def ancestor_issues(anc: set[str] = anc) -> list[dict[str, Any]]:
            out: list[dict[str, Any]] = []
            for k in graph.order(defn) or []:
                if k in anc:
                    out.extend(steps[k].issues or [])
            return out

        ctx = Context(
            db=db,
            org_id=run.organization_id,
            node_key=key,
            label=node["label"],
            workflow_name=wf.name,
            version_number=version.number,
            run_id=run.id,
            input_files=inputs_files,
            ancestor_issues=ancestor_issues,
            provenance=provenance,
        )
        step.status, step.started_at, step.error = "running", _now(), ""
        db.commit()
        retries = min(int(node["config"].get("retries") or 0), MAX_RETRIES)
        result: NodeResult | None = None
        error = ""
        logs = list(step.logs or [])
        for attempt in range(1, retries + 2):
            step.attempts = attempt
            try:
                result = spec.run(ctx, inputs, node["config"])
                break
            except NodeError as e:
                db.rollback()
                error = str(e)
                logs.append(f"Failed: {error}")
                break
            except Exception:
                db.rollback()
                logger.exception("workflow step error", extra={"run_id": str(run.id), "node": key, "attempt": attempt})
                error = f"Unexpected error in {node['label']}."
                logs.append(f"Attempt {attempt} failed unexpectedly." + (" Retrying." if attempt <= retries else ""))
        run = db.get(M.WorkflowRun, run.id)  # type: ignore[assignment]
        step = db.get(M.WorkflowStepRun, step.id)  # type: ignore[assignment]
        assert run is not None and step is not None
        steps[key] = step
        step.attempts = attempt
        step.finished_at = _now()
        if result is None:
            step.status, step.error, step.logs = "failed", error, logs
            _finish(db, run, steps, "failed", f"{node['label']}: {error}")
            return
        step.logs = logs + result.logs
        step.issues = [{**i, "step": node["label"], "node": key} for i in result.issues]
        step.outputs = {port: t.preview() for port, t in result.outputs.items()}
        for port, t in result.outputs.items():
            cache[(key, port)] = t
            data = t.to_json_bytes()
            db.add(
                M.WorkflowArtifact(
                    organization_id=run.organization_id,
                    run_id=run.id,
                    step_run_id=step.id,
                    kind="step_data",
                    name=port,
                    content_type="application/json+gzip",
                    size_bytes=len(data),
                    sha256=_sha(data),
                    content=data,
                )
            )
        for a in result.artifacts:
            db.add(
                M.WorkflowArtifact(
                    organization_id=run.organization_id,
                    run_id=run.id,
                    step_run_id=step.id,
                    kind="output",
                    name=a.name,
                    content_type=a.content_type,
                    size_bytes=len(a.content),
                    sha256=_sha(a.content),
                    content=a.content,
                )
            )
        step.status = "completed"
        db.commit()
    _finish(db, run, steps, "completed", "")


def _finish(db: Session, run: M.WorkflowRun, steps: dict[str, M.WorkflowStepRun], status: str, error: str) -> None:
    for s in steps.values():
        if s.status in ("pending", "waiting_approval", "running"):
            s.status = "cancelled" if status == "cancelled" else "skipped"
    counts = {"error": 0, "warning": 0, "info": 0}
    for s in steps.values():
        for i in s.issues or []:
            counts[i.get("severity", "info")] = counts.get(i.get("severity", "info"), 0) + 1
    outputs = db.scalars(
        select(M.WorkflowArtifact.name).where(M.WorkflowArtifact.run_id == run.id, M.WorkflowArtifact.kind == "output")
    ).all()
    run.status, run.error, run.finished_at = status, error, _now()
    run.summary = {
        "issues": counts,
        "steps": {st: sum(1 for s in steps.values() if s.status == st) for st in {s.status for s in steps.values()}},
        "artifacts": list(outputs),
    }
    db.commit()
    logger.info("workflow run finished", extra={"run_id": str(run.id), "status": status})


def request_cancel(db: Session, run: M.WorkflowRun) -> None:
    if run.status in TERMINAL:
        raise NodeError(f"The run is already {run.status}.")
    run.cancel_requested = True
    if run.status in ("queued", "waiting_approval"):
        steps = {s.node_key: s for s in db.scalars(select(M.WorkflowStepRun).where(M.WorkflowStepRun.run_id == run.id))}
        for a in db.scalars(
            select(M.WorkflowApproval).where(
                M.WorkflowApproval.run_id == run.id, M.WorkflowApproval.status == "pending"
            )
        ):
            a.status = "cancelled"
        _finish(db, run, steps, "cancelled", "Cancelled by a reviewer.")
    else:
        db.commit()


def decide(db: Session, approval: M.WorkflowApproval, user_id: uuid.UUID, decision: str, note: str) -> M.WorkflowRun:
    run = db.get(M.WorkflowRun, approval.run_id)
    assert run is not None
    if approval.status != "pending" or run.status != "waiting_approval":
        raise NodeError("This approval has already been decided.")
    approval.status = "approved" if decision == "approve" else "rejected"
    approval.decided_by, approval.decided_at, approval.note = user_id, _now(), note
    step = db.get(M.WorkflowStepRun, approval.step_run_id)
    assert step is not None
    step.logs = [*step.logs, f"{_now().isoformat(timespec='seconds')} {approval.status.capitalize()}: {note}"]
    if decision == "approve":
        step.status = "pending"
        run.status = "queued"  # the engine claims it again and continues after the gate
        db.commit()
    else:
        step.status = "failed"
        step.error = f"Rejected: {note}"
        steps = {s.node_key: s for s in db.scalars(select(M.WorkflowStepRun).where(M.WorkflowStepRun.run_id == run.id))}
        _finish(db, run, steps, "rejected", f"Rejected at {step.label}: {note}")
    return run
