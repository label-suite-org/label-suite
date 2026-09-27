"use client";

import { useId, useState, type SubmitEvent } from "react";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
export interface BudgetCategory {
  id: string;
  name: string;
  type: string | null;
}

export function BudgetItemForm({
  releaseId,
  categories,
  onClose,
}: {
  releaseId: string;
  categories: BudgetCategory[];
  onClose: () => void;
}) {
  const formId = useId();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("pending");
  const [categoryId, setCategoryId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/budget-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release_id: releaseId,
          name,
          amount: Number(amount),
          status,
          category_id: categoryId || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed"); }
      window.location.reload();
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label htmlFor={`${formId}-name`} className="block text-sm font-medium text-neutral-700 mb-1">Item Name *</label>
        <Input id={`${formId}-name`} value={name} onChange={(e) => setName(e.target.value)} required
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-category`} className="block text-sm font-medium text-neutral-700 mb-1">Category</label>
          <NativeSelect id={`${formId}-category`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900">
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name} {c.type ? `(${c.type})` : ""}</option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${formId}-amount`} className="block text-sm font-medium text-neutral-700 mb-1">Amount (DKK)</label>
          <Input id={`${formId}-amount`} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required min="0"
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
        </div>
      </div>
      <div>
        <label htmlFor={`${formId}-status`} className="block text-sm font-medium text-neutral-700 mb-1">Status</label>
        <NativeSelect id={`${formId}-status`} value={status} onChange={(e) => setStatus(e.target.value)}
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900">
          <option value="pending">Pending</option><option value="approved">Approved</option><option value="paid">Paid</option>
        </NativeSelect>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" type="button" onClick={onClose} className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900">Cancel</Button>
        <Button variant="ghost" type="submit" disabled={loading}
          className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50">
          {loading ? "Adding..." : "Add Item"}
        </Button>
      </div>
    </form>
  );
}
