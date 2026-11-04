"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { api, errorText } from "@/lib/api";

type Doc = {
  id: string;
  filename: string;
  status: string;
  processing_status: string;
  page_count: number;
  tenant_id: string | null;
  extraction?: Extraction | null;
};

type Term = {
  id: string;
  field_name: string;
  proposed_value: string | null;
  source_page: number | null;
  supporting_excerpt: string | null;
  confidence: string;
  uncertainty: string;
  review_status: string;
};

type Extraction = {
  id: string;
  status: string;
  conflicts: string[];
  incomplete_document_warning: string | null;
  terms: Term[];
};

export default function DocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const nextDocs = await api.get<Doc[]>(`/properties/${id}/lease-documents`);
    // Network hydration is intentionally performed after mount for this client-only screen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDocs(nextDocs);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().catch((error) => setMessage(errorText(error)));
  }, [refresh]);

  async function upload() {
    if (!file || !tenantId) return;
    setBusy(true);
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("tenant_id", tenantId);
      body.append("document_type", "lease");
      await api.post(`/properties/${id}/lease-documents`, body);
      setFile(null);
      await refresh();
      setMessage("Lease uploaded. Start analysis when ready.");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function analyze(docId: string) {
    setBusy(true);
    setMessage("");
    try {
      await api.post(`/lease-documents/${docId}/analyze`, {});
      await refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function decide(termId: string, status: "approved" | "rejected") {
    setBusy(true);
    try {
      await api.patch(`/lease-extraction-terms/${termId}`, {
        status,
        note: status === "approved" ? "Reviewed and approved." : "Rejected during review.",
      });
      await refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Documents</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Lease intelligence</h1>
        <p className="mt-1 text-sm text-slate-600">
          Extract proposed terms with page citations. Nothing becomes a calculation input without review.
        </p>
      </div>

      <Panel className="p-5">
        <h2 className="font-semibold text-slate-950">Upload a lease PDF</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input
            aria-label="Tenant ID"
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
            placeholder="Tenant ID"
            className="rounded-md border px-3 py-2 text-sm"
          />
          <input
            aria-label="Lease PDF"
            type="file"
            accept="application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="rounded-md border px-3 py-2 text-sm"
          />
          <Button onClick={upload} disabled={busy || !file || !tenantId}>
            Upload
          </Button>
        </div>
        {message && (
          <p role="status" className="mt-3 text-sm text-slate-600">
            {message}
          </p>
        )}
      </Panel>

      <div className="space-y-4">
        {docs.map((doc) => (
          <Panel key={doc.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-950">{doc.filename}</h2>
                <p className="text-sm text-slate-500">
                  {doc.page_count} pages · {doc.status}
                </p>
              </div>
              {!doc.extraction && (
                <Button variant="secondary" onClick={() => analyze(doc.id)} disabled={busy || doc.processing_status !== "text_extracted"}>
                  Analyze lease
                </Button>
              )}
            </div>

            {doc.extraction && (
              <div className="mt-5 overflow-x-auto">
                <p className="mb-3 text-sm font-medium">Review proposed terms</p>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase text-slate-500">
                      <th className="px-2 py-2">Term</th>
                      <th className="px-2 py-2">Proposal</th>
                      <th className="px-2 py-2">Source</th>
                      <th className="px-2 py-2">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.extraction.terms.map((term) => (
                      <tr key={term.id} className="border-b align-top">
                        <td className="px-2 py-3 font-medium">{term.field_name}</td>
                        <td className="max-w-md px-2 py-3">
                          {term.proposed_value || "Not found"}
                          <div className="mt-1 text-xs text-slate-500">{term.uncertainty}</div>
                        </td>
                        <td className="max-w-sm px-2 py-3 text-xs text-slate-600">
                          p. {term.source_page ?? "—"} · {term.supporting_excerpt || "No citation"}
                        </td>
                        <td className="px-2 py-3">
                          <span className="mr-2 text-xs text-slate-500">{term.review_status}</span>
                          <Button size="sm" onClick={() => decide(term.id, "approved")} disabled={busy}>
                            Approve
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => decide(term.id, "rejected")} disabled={busy}>
                            Reject
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}
