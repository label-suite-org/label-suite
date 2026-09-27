import { useEffect, useState, type SubmitEvent } from "react";
import { uploadFileToStorage } from "../../lib/storage-client";
import type { GrantsWorkspacePayload } from "./grants-workspace-ui";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
type SupportingDocument = { id: string; document_id: string; name: string; file_link: string | null; asset_role: string; link_type: string; required: boolean; readiness_status: string; extraction_status?: string | null; extraction_error?: string | null; extracted_text_preview?: string | null };

export function GrantWorkspaceTools({ workspace }: { workspace: GrantsWorkspacePayload }) {
  const [applicationId, setApplicationId] = useState(workspace.applications[0]?.id ?? "");
  const [documents, setDocuments] = useState<SupportingDocument[]>([]);
  const [message, setMessage] = useState("");
  const [library, setLibrary] = useState<Array<{ id: string; name: string; doc_type: string | null }>>([]);

  useEffect(() => {
    if (!applicationId) { setDocuments([]); return; }
    void fetch(`/api/grant-applications/${applicationId}/documents?library=1`).then(async (response) => {
      if (!response.ok) throw new Error("Could not load supporting documents");
      return response.json();
    }).then((payload) => { setDocuments(payload.documents ?? []); setLibrary(payload.library ?? []); }).catch(() => { setDocuments([]); setLibrary([]); });
  }, [applicationId]);

  async function submit(path: string, body: unknown, method = "POST") {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Could not save");
    setMessage("Saved.");
    return response.json();
  }

  async function saveProfile(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await submit("/api/funding-profiles", { project_id: data.get("project_id"), priority: data.get("priority"), goal: data.get("goal") || null, target_date: data.get("target_date") || null });
  }
  async function saveDeadline(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await submit("/api/grant-deadlines", { grant_id: data.get("grant_id"), deadline_date: data.get("deadline_date"), label: data.get("label") || null, status: "planned" });
  }
  async function upload(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (!applicationId) return; const form = event.currentTarget; const data = new FormData(form); const file = data.get("file");
    if (!(file instanceof File) || !file.size) return;
    const uploaded = await uploadFileToStorage(file, "unused", { type: "grant_application", id: applicationId });
    const linked = await submit(`/api/grant-applications/${applicationId}/documents`, { storage_key: uploaded.key, name: file.name, asset_role: data.get("asset_role") || "other", readiness_status: "draft" });
    setDocuments((current) => [...current, { id: linked.id, document_id: linked.documentId, name: file.name, file_link: uploaded.key, asset_role: String(data.get("asset_role") || "other"), link_type: "attachment", required: false, readiness_status: "draft" }]);
    form.reset();
  }
  async function linkExisting(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (!applicationId) return; const data = new FormData(event.currentTarget);
    const result = await submit(`/api/grant-applications/${applicationId}/documents`, { document_id: data.get("document_id"), asset_role: data.get("asset_role") || "other" });
    const selected = library.find((item) => item.id === data.get("document_id"));
    if (selected) setDocuments((current) => [...current, { id: result.id, document_id: selected.id, name: selected.name, file_link: null, asset_role: String(data.get("asset_role") || "other"), link_type: "attachment", required: false, readiness_status: "draft" }]);
    setLibrary((current) => current.filter((item) => item.id !== data.get("document_id")));
  }
  async function unlink(linkId: string) {
    await submit(`/api/grant-applications/${applicationId}/documents`, { link_id: linkId }, "DELETE");
    setDocuments((current) => current.filter((document) => document.id !== linkId));
  }
  async function replace(document: SupportingDocument, file: File) {
    const uploaded = await uploadFileToStorage(file, "unused", { type: "grant_application", id: applicationId });
    await submit(`/api/grant-applications/${applicationId}/documents`, { storage_key: uploaded.key, name: file.name, asset_role: document.asset_role, required: document.required, readiness_status: "draft", replace_link_id: document.id });
    window.location.reload();
  }

  async function extract(document: SupportingDocument) {
    const response = await fetch(`/api/grant-applications/${applicationId}/documents/${document.id}/extract`, { method: "POST", headers: { "Content-Type": "application/json" } });
    if (!response.ok) throw new Error("Extraction failed");
    const payload = await response.json();
    setDocuments((current) => current.map((item) => item.id === document.id ? { ...item, extraction_status: payload.extraction.status, extraction_error: payload.extraction.error, extracted_text_preview: payload.extraction.extractedText?.slice(0, 1000) } : item));
  }

  return <section className="grid gap-4 border border-border p-4 lg:grid-cols-3" aria-label="Fundraising workspace tools">
    <form className="space-y-3" onSubmit={saveProfile}><h2 className="font-semibold">Funding profile</h2><NativeSelect required name="project_id" className="w-full border border-input bg-background p-2 text-sm"><option value="">Select project</option>{workspace.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</NativeSelect><NativeSelect name="priority" className="w-full border border-input bg-background p-2 text-sm"><option>medium</option><option>high</option><option>low</option></NativeSelect><Input name="target_date" type="date" className="w-full border border-input bg-background p-2 text-sm" /><Textarea name="goal" placeholder="Funding goal" className="w-full border border-input bg-background p-2 text-sm" /><Button type="submit" className="bg-primary px-3 py-2 text-sm text-primary-foreground">Save profile</Button></form>
    <form className="space-y-3" onSubmit={saveDeadline}><h2 className="font-semibold">Recurring grant deadline</h2><NativeSelect required name="grant_id" className="w-full border border-input bg-background p-2 text-sm"><option value="">Select grant</option>{workspace.opportunities.map((grant) => <option key={grant.id} value={grant.id}>{grant.name}</option>)}</NativeSelect><Input required name="deadline_date" type="date" className="w-full border border-input bg-background p-2 text-sm" /><Input name="label" placeholder="Round label" className="w-full border border-input bg-background p-2 text-sm" /><Button type="submit" className="bg-primary px-3 py-2 text-sm text-primary-foreground">Add deadline</Button></form>
    <div className="space-y-3"><h2 className="font-semibold">Supporting documents</h2><NativeSelect value={applicationId} onChange={(event) => setApplicationId(event.target.value)} className="w-full border border-input bg-background p-2 text-sm"><option value="">Select application</option>{workspace.applications.map((application) => <option key={application.id} value={application.id}>{application.name}</option>)}</NativeSelect><form className="space-y-2" onSubmit={upload}><Input required name="file" type="file" accept=".pdf" /><NativeSelect name="asset_role" defaultValue="other" className="w-full border border-input bg-background p-2 text-sm"><option value="submitted_application">Submitted application</option><option value="award_decision">Award-decision letter</option><option value="expense_documentation">Expense documentation</option><option value="other">Other</option></NativeSelect><Button type="submit" variant="outline" disabled={!applicationId} className="border border-border px-3 py-2 text-sm">Upload and link</Button></form><form className="flex gap-2" onSubmit={linkExisting}><NativeSelect required name="document_id" defaultValue="" className="min-w-0 flex-1 border border-input bg-background p-2 text-sm"><option value="">Link existing organization document…</option>{library.map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}</NativeSelect><NativeSelect name="asset_role" defaultValue="other" className="border border-input bg-background p-2 text-sm"><option value="submitted_application">Submitted application</option><option value="award_decision">Award-decision letter</option><option value="expense_documentation">Expense documentation</option><option value="other">Other</option></NativeSelect><Button type="submit" variant="outline" disabled={!applicationId} className="border border-border px-3 py-2 text-sm">Link</Button></form><ul className="space-y-2">{documents.map((document) => <li key={document.id} className="space-y-1 text-sm"><div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 truncate">{document.name}</span><label className="cursor-pointer underline">Replace<Input type="file" accept=".pdf" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void replace(document, file); }} /></label><Button variant="link" type="button" className="underline" onClick={() => void extract(document)}>Extract</Button><Button variant="link" type="button" className="text-red-600 underline" onClick={() => void unlink(document.id)}>Unlink</Button></div>{document.extraction_status === "failed" && <p className="text-xs text-red-700">Extraction failed: {document.extraction_error}</p>}{document.extracted_text_preview && <p className="line-clamp-2 text-xs text-muted-foreground">{document.extracted_text_preview}</p>}</li>)}</ul>{message && <p className="text-xs text-muted-foreground">{message}</p>}</div>
  </section>;
}
