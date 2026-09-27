"use client";

import { useMemo } from "react";

export interface BudgetItemWithCategory {
  id: string;
  name: string;
  amount: number;
  status: string | null;
  category_name: string | null;
  category_type: string | null;
}

interface Props {
  items: BudgetItemWithCategory[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-200 text-yellow-800",
  approved: "bg-blue-200 text-blue-800",
  paid: "bg-green-200 text-green-800",
};

const BUCKET_COLORS: Record<string, string> = {
  marketing: "bg-blue-500",
  a_and_r: "bg-purple-500",
  digital: "bg-cyan-500",
  manufacturing: "bg-orange-500",
  publicity: "bg-pink-500",
  other: "bg-gray-400",
};

function bucketColor(bucket: string): string {
  const key = bucket.toLowerCase().replace(/[\s&-]+/g, "_");
  return BUCKET_COLORS[key] || "bg-gray-400";
}

export function BudgetBucketSummary({ items }: Props) {
  const { buckets, grandTotal } = useMemo(() => {
    const map = new Map<string, { label: string; items: BudgetItemWithCategory[]; total: number }>();

    for (const item of items) {
      const key = item.category_type || "uncategorized";
      if (!map.has(key)) {
        map.set(key, {
          label: item.category_name || key,
          items: [],
          total: 0,
        });
      }
      const bucket = map.get(key)!;
      bucket.items.push(item);
      bucket.total += item.amount ?? 0;
    }

    const buckets = Array.from(map.entries())
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => b.total - a.total);

    const grandTotal = buckets.reduce((s, b) => s + b.total, 0);

    return { buckets, grandTotal };
  }, [items]);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No budget items yet.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Bucket summary bars */}
      <div className="space-y-3">
        {buckets.map((bucket) => {
          const pct = grandTotal > 0 ? ((bucket.total / grandTotal) * 100).toFixed(1) : "0.0";
          return (
            <div key={bucket.key} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{bucket.label}</span>
                  <span className="text-xs text-muted-foreground">({bucket.items.length} items)</span>
                </div>
                <div className="text-right">
                  <span className="text-lg font-bold">${Number(bucket.total).toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground ml-2">{pct}% of total</span>
                </div>
              </div>
              {/* Bar */}
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${bucketColor(bucket.key)}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {/* Individual items */}
              <div className="mt-3 space-y-1">
                {bucket.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-1 text-sm">
                    <span className="text-muted-foreground">{item.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">${Number(item.amount).toLocaleString()}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        (STATUS_COLORS as Record<string, string>)[item.status ?? ""] || "bg-muted text-muted-foreground"
                      }`}>
                        {item.status ?? "pending"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Grand total footer */}
      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border">
        <span className="text-sm font-semibold">Total Budget</span>
        <span className="text-xl font-bold">${Number(grandTotal).toLocaleString()}</span>
      </div>
    </div>
  );
}