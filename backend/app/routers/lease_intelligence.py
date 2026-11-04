"""Lease document ingestion, source-grounded extraction, and human review."""
from __future__ import annotations

import hashlib
import io
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import ai
from .. import models as M
from ..auth import Actor, current_actor
from ..config import settings
from ..db import get_session
from ..scoping import get_owned

router = APIRouter()


class TermDecision(BaseModel):
    status: str = Field(pattern="^(approved|rejected|needs_review)$")
    note: str = Field(min_length=3, max_length=2000)


def _pdf_pages(content: bytes) -> list[str]:
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(422, "This PDF could not be read. Upload a text-readable PDF or provide OCR first.") from exc
    return [(page.extract_text() or "").strip() for page in reader.pages]


def _doc(db: Session, doc_id: uuid.UUID, actor: Actor) -> dict:
    row = db.execute(
        text(
            """select d.*, v.id as version_id, v.version_number, v.processing_status,
                      v.page_count, v.extracted_text, v.source_file_id
               from lease_documents d
               join document_versions v on v.id = d.current_version_id
              where d.id = :id and d.organization_id = :org"""
        ),
        {"id": doc_id, "org": actor.org_id},
    ).mappings().first()
    if not row:
        raise HTTPException(404, "Lease document not found.")
    return dict(row)


def _out(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "property_id": str(row["property_id"]),
        "tenant_id": str(row["tenant_id"]) if row["tenant_id"] else None,
        "filename": row["filename"],
        "document_type": row["document_type"],
        "status": row["status"],
        "version_id": str(row["version_id"]),
        "version_number": row["version_number"],
        "processing_status": row["processing_status"],
        "page_count": row["page_count"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


@router.post("/properties/{pid}/lease-documents", status_code=201)
async def upload_lease_document(
    pid: uuid.UUID,
    file: UploadFile = File(...),
    tenant_id: uuid.UUID = Form(...),
    document_type: str = Form("lease"),
    actor: Actor = Depends(current_actor),
    db: Session = Depends(get_session),
):
    get_owned(db, M.Property, pid, actor)
    get_owned(db, M.Tenant, tenant_id, actor)
    if document_type not in {"lease", "amendment"}:
        raise HTTPException(422, "document_type must be lease or amendment.")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(415, "Lease intelligence currently accepts PDF files only.")
    content = await file.read()
    if not content or len(content) > settings.max_upload_bytes:
        raise HTTPException(413, "The uploaded PDF is empty or exceeds the configured upload limit.")

    source = M.SourceFile(
        organization_id=actor.org_id,
        filename=file.filename[:300],
        content_type="application/pdf",
        sha256=hashlib.sha256(content).hexdigest(),
        size_bytes=len(content),
        content=content,
        uploaded_by=actor.user_id,
    )
    db.add(source)
    db.flush()
    pages = _pdf_pages(content)
    document_id, version_id = uuid.uuid4(), uuid.uuid4()
    status = "text_extracted" if any(pages) else "needs_ocr"
    now = datetime.now(timezone.utc)
    db.execute(
        text(
            """insert into lease_documents
               (id, organization_id, property_id, tenant_id, document_type, filename, status)
               values (:id, :org, :property, :tenant, :kind, :filename, :status)"""
        ),
        {"id": document_id, "org": actor.org_id, "property": pid, "tenant": tenant_id, "kind": document_type,
         "filename": file.filename[:300], "status": status},
    )
    db.execute(
        text(
            """insert into document_versions
               (id, organization_id, document_id, source_file_id, version_number,
                processing_status, page_count, extracted_text)
               values (:id, :org, :document, :source, 1, :status, :pages, :text)"""
        ),
        {"id": version_id, "org": actor.org_id, "document": document_id, "source": source.id,
         "status": status, "pages": len(pages), "text": "\n\n".join(pages)},
    )
    db.execute(text("update lease_documents set current_version_id = :version where id = :id and organization_id = :org"), {"version": version_id, "id": document_id, "org": actor.org_id})
    db.commit()
    return _out(_doc(db, document_id, actor))


@router.get("/properties/{pid}/lease-documents")
def list_lease_documents(pid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    rows = db.execute(
        text(
            """select d.*, v.id as version_id, v.version_number, v.processing_status,
                      v.page_count, v.extracted_text, v.source_file_id
               from lease_documents d join document_versions v on v.id = d.current_version_id
              where d.organization_id = :org and d.property_id = :property
              order by d.created_at desc"""
        ),
        {"org": actor.org_id, "property": pid},
    ).mappings().all()
    return [_out(dict(row)) for row in rows]


@router.get("/lease-documents/{doc_id}")
def get_lease_document(doc_id: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    row = _doc(db, doc_id, actor)
    extraction = db.execute(
        text("select * from lease_extractions where organization_id = :org and document_version_id = :version order by created_at desc limit 1"),
        {"org": actor.org_id, "version": row["version_id"]},
    ).mappings().first()
    result = _out(row)
    result["extraction"] = None
    if extraction:
        terms = db.execute(
            text("select * from extracted_lease_terms where organization_id = :org and extraction_id = :id order by field_name"),
            {"org": actor.org_id, "id": extraction["id"]},
        ).mappings().all()
        result["extraction"] = {
            "id": str(extraction["id"]),
            "status": extraction["status"],
            "provider": extraction["provider"],
            "model": extraction["model"],
            "conflicts": extraction["conflicts"],
            "incomplete_document_warning": extraction["incomplete_document_warning"],
            "terms": [
{"id": str(term["id"]), "extraction_id": str(term["extraction_id"]), "field_name": term["field_name"], "proposed_value": term["proposed_value"], "source_page": term["source_page"], "supporting_excerpt": term["supporting_excerpt"], "confidence": term["confidence"], "uncertainty": term["uncertainty"], "review_status": term["review_status"], "review_note": term["review_note"], "reviewed_at": term["reviewed_at"].isoformat() if term["reviewed_at"] else None}
                for term in terms
            ],
        }
    return result


@router.post("/lease-documents/{doc_id}/analyze")
def analyze_lease_document(doc_id: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    row = _doc(db, doc_id, actor)
    if row["processing_status"] != "text_extracted":
        raise HTTPException(422, "The document must have extracted text before analysis.")
    pages = str(row["extracted_text"]).split("\n\n")
    extraction_id = uuid.uuid4()
    if not ai.configured():
        db.execute(
            text(
                """insert into lease_extractions
                   (id, organization_id, document_version_id, status, provider, model)
                   values (:id, :org, :version, 'disabled', 'openai', null)"""
            ),
            {"id": extraction_id, "org": actor.org_id, "version": row["version_id"]},
        )
        db.commit()
        raise HTTPException(503, "AI lease extraction is disabled. Set VEYRA_OPENAI_API_KEY on the server.")
    try:
        parsed, usage = ai.extract_lease_terms(pages)
    except ai.AIProviderError as exc:
        raise HTTPException(502, str(exc)) from exc
    db.execute(
        text(
            """insert into lease_extractions
               (id, organization_id, document_version_id, status, provider, model, conflicts, incomplete_document_warning,
                input_tokens, output_tokens)
               values (:id, :org, :version, 'needs_review', 'openai', :model, :conflicts, :warning, :input, :output)"""
        ),
        {"id": extraction_id, "org": actor.org_id, "version": row["version_id"], "model": usage["model"],
         "conflicts": json.dumps(parsed.conflicts), "warning": parsed.incomplete_document_warning,
         "input": usage["input_tokens"], "output": usage["output_tokens"]},
    )
    for term in parsed.terms:
        db.execute(
            text(
                """insert into extracted_lease_terms
                   (id, organization_id, extraction_id, field_name, proposed_value, source_page,
                    supporting_excerpt, confidence, uncertainty)
                   values (:id, :org, :extraction, :field, :value, :page, :excerpt, :confidence, :uncertainty)"""
            ),
            {"id": uuid.uuid4(), "org": actor.org_id, "extraction": extraction_id, "field": term.field_name,
             "value": term.proposed_value, "page": term.source_page, "excerpt": term.supporting_excerpt,
             "confidence": term.confidence, "uncertainty": term.uncertainty},
        )
    db.execute(
        text("update lease_documents set status = 'needs_review' where id = :id and organization_id = :org"),
        {"id": doc_id, "org": actor.org_id},
    )
    db.commit()
    return get_lease_document(doc_id, actor, db)


@router.patch("/lease-extraction-terms/{term_id}")
def decide_lease_term(
    term_id: uuid.UUID, body: TermDecision, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)
):
    term = db.execute(
        text("select * from extracted_lease_terms where id = :id and organization_id = :org"),
        {"id": term_id, "org": actor.org_id},
    ).mappings().first()
    if not term:
        raise HTTPException(404, "Extraction term not found.")
    db.execute(
        text(
            """update extracted_lease_terms
               set review_status = :status, review_note = :note, reviewed_by = :user, reviewed_at = now()
             where id = :id and organization_id = :org"""
        ),
        {"id": term_id, "org": actor.org_id, "status": body.status, "note": body.note, "user": actor.user_id},
    )
    db.commit()
    return {"id": str(term_id), "status": body.status, "note": body.note}


@router.post("/lease-extractions/{extraction_id}/apply")
def apply_reviewed_terms(
    extraction_id: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)
):
    extraction = db.execute(
        text(
            """select e.*, d.property_id, d.tenant_id, d.id as document_id
               from lease_extractions e join document_versions v on v.id = e.document_version_id
               join lease_documents d on d.id = v.document_id
              where e.id = :id and e.organization_id = :org"""
        ),
        {"id": extraction_id, "org": actor.org_id},
    ).mappings().first()
    if not extraction:
        raise HTTPException(404, "Extraction not found.")
    terms = db.execute(
        text(
            "select * from extracted_lease_terms where extraction_id = :id and organization_id = :org and review_status = 'approved'"
        ),
        {"id": extraction_id, "org": actor.org_id},
    ).mappings().all()
    if not terms:
        raise HTTPException(422, "Approve at least one extracted term before applying.")
    approved = {t["field_name"]: t["proposed_value"] for t in terms if t["proposed_value"]}
    if any(t["review_status"] == "needs_review" for t in db.execute(
        text("select review_status from extracted_lease_terms where extraction_id = :id and organization_id = :org"),
        {"id": extraction_id, "org": actor.org_id},
    ).mappings().all()):
        raise HTTPException(422, "Review every extracted term before applying.")
    tenant_id = extraction["tenant_id"]
    if "premises_square_feet" in approved:
        try:
            db.execute(text("update tenants set rentable_area = :area where id = :id and organization_id = :org"),
                       {"area": approved["premises_square_feet"], "id": tenant_id, "org": actor.org_id})
        except Exception as exc:
            raise HTTPException(422, "Approved premises square footage is not numeric.") from exc
    notes = "\n".join(f"{key}: {value}" for key, value in approved.items())
    rule_id = uuid.uuid4()
    ref = f"AI-{str(extraction_id)[:8]}"
    db.execute(
        text(
            """insert into lease_rules
               (id, organization_id, property_id, ref, status, version, unsupported_terms, source_ref, notes)
               values (:id, :org, :property, :ref, 'draft', 1, :unsupported, :source, :notes)"""
        ),
        {"id": rule_id, "org": actor.org_id, "property": extraction["property_id"], "ref": ref,
         "unsupported": json.dumps([key for key in approved if key not in {"premises_square_feet", "lease_commencement", "lease_expiration"}]),
         "source": f"Lease document {extraction['document_id']}",
         "notes": notes},
    )
    db.execute(
        text("update lease_extractions set status = 'applied' where id = :id and organization_id = :org"),
        {"id": extraction_id, "org": actor.org_id},
    )
    db.commit()
    return {"lease_rule_id": str(rule_id), "status": "draft", "message": "Applied as a draft. Approve it in Lease Rules before calculations can use it."}
