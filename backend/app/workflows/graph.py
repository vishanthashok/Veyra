"""Workflow definitions: normalization, validation and dependency order."""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict, deque
from typing import Any

from .nodes import REGISTRY

MAX_NODES = 60
KEY = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def normalize(defn: dict[str, Any]) -> dict[str, Any]:
    nodes = []
    for n in defn.get("nodes") or []:
        nodes.append(
            {
                "id": str(n.get("id", "")),
                "type": str(n.get("type", "")),
                "label": str(n.get("label") or "")[:200],
                "config": n.get("config") or {},
                "position": {
                    "x": float((n.get("position") or {}).get("x", 0)),
                    "y": float((n.get("position") or {}).get("y", 0)),
                },
            }
        )
    edges = []
    for i, e in enumerate(defn.get("edges") or []):
        edges.append(
            {
                "id": str(e.get("id") or f"e{i}"),
                "source": str(e.get("source", "")),
                "source_port": str(e.get("source_port") or "out"),
                "target": str(e.get("target", "")),
                "target_port": str(e.get("target_port") or "in"),
            }
        )
    for n in nodes:
        spec = REGISTRY.get(n["type"])
        if spec and not n["label"]:
            n["label"] = spec.label
    return {"nodes": nodes, "edges": edges}


def definition_hash(defn: dict[str, Any]) -> str:
    """Hash of what executes. Node positions are layout only and do not change it."""
    core = {
        "nodes": sorted(({k: n[k] for k in ("id", "type", "config")} for n in defn["nodes"]), key=lambda n: n["id"]),
        "edges": sorted(
            ({k: e[k] for k in ("source", "source_port", "target", "target_port")} for e in defn["edges"]),
            key=json.dumps,
        ),
    }
    return hashlib.sha256(json.dumps(core, sort_keys=True, default=str).encode()).hexdigest()


def validate(defn: dict[str, Any]) -> list[dict[str, str]]:
    """Return problems as [{node, message}]; empty means the workflow can run."""
    errs: list[dict[str, str]] = []
    nodes = {n["id"]: n for n in defn["nodes"]}
    if not defn["nodes"]:
        return [{"node": "", "message": "Add at least one step."}]
    if len(defn["nodes"]) > MAX_NODES:
        errs.append({"node": "", "message": f"Workflows are limited to {MAX_NODES} steps."})
    if len(nodes) != len(defn["nodes"]):
        errs.append({"node": "", "message": "Two steps share the same id."})
    for n in defn["nodes"]:
        if not KEY.match(n["id"]):
            errs.append({"node": n["id"], "message": "Step ids may use letters, numbers, - and _ only."})
        spec = REGISTRY.get(n["type"])
        if spec is None:
            errs.append({"node": n["id"], "message": f"Unknown step type {n['type']!r}."})
            continue
        for m in spec.config_errors(n["config"]):
            errs.append({"node": n["id"], "message": m})
    incoming: dict[tuple[str, str], int] = defaultdict(int)
    for e in defn["edges"]:
        s, t = nodes.get(e["source"]), nodes.get(e["target"])
        if s is None or t is None:
            errs.append({"node": "", "message": f"Connection {e['id']} points to a missing step."})
            continue
        if e["source"] == e["target"]:
            errs.append({"node": e["source"], "message": "A step cannot connect to itself."})
        sspec, tspec = REGISTRY.get(s["type"]), REGISTRY.get(t["type"])
        if sspec and e["source_port"] not in sspec.outputs:
            errs.append({"node": s["id"], "message": f"{s['label']} has no output {e['source_port']!r}."})
        if tspec:
            port = next((p for p in tspec.inputs if p.name == e["target_port"]), None)
            if port is None:
                errs.append({"node": t["id"], "message": f"{t['label']} has no input {e['target_port']!r}."})
            else:
                incoming[(t["id"], port.name)] += 1
                if incoming[(t["id"], port.name)] > 1 and not port.multi:
                    errs.append(
                        {"node": t["id"], "message": f"{t['label']}: input {port.label!r} accepts one connection."}
                    )
    for n in defn["nodes"]:
        spec = REGISTRY.get(n["type"])
        if not spec:
            continue
        for p in spec.inputs:
            if p.required and incoming[(n["id"], p.name)] == 0:
                errs.append({"node": n["id"], "message": f"{n['label']}: connect a step to {p.label!r}."})
    if not errs and order(defn) is None:
        errs.append({"node": "", "message": "The workflow has a cycle. Steps must flow in one direction."})
    return errs


def order(defn: dict[str, Any]) -> list[str] | None:
    """Dependency order (Kahn). Ties keep the definition order so runs are deterministic. None if cyclic."""
    ids = [n["id"] for n in defn["nodes"]]
    indeg = dict.fromkeys(ids, 0)
    out: dict[str, list[str]] = defaultdict(list)
    for e in defn["edges"]:
        if e["source"] in indeg and e["target"] in indeg:
            out[e["source"]].append(e["target"])
            indeg[e["target"]] += 1
    pos = {k: i for i, k in enumerate(ids)}
    ready = deque(sorted((k for k, d in indeg.items() if d == 0), key=pos.__getitem__))
    result: list[str] = []
    while ready:
        k = ready.popleft()
        result.append(k)
        for t in sorted(out[k], key=pos.__getitem__):
            indeg[t] -= 1
            if indeg[t] == 0:
                ready.append(t)
        ready = deque(sorted(ready, key=pos.__getitem__))
    return result if len(result) == len(ids) else None


def ancestors(defn: dict[str, Any], node_id: str) -> set[str]:
    parents: dict[str, list[str]] = defaultdict(list)
    for e in defn["edges"]:
        parents[e["target"]].append(e["source"])
    seen: set[str] = set()
    stack = list(parents[node_id])
    while stack:
        k = stack.pop()
        if k not in seen:
            seen.add(k)
            stack.extend(parents[k])
    return seen
