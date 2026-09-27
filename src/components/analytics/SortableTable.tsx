"use client";

import { useState, useMemo, type ReactNode } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

interface Column<T> {
  key: keyof T;
  label: string;
  align?: "left" | "right";
  formatter?: (row: T) => ReactNode;
  sortable?: boolean;
  width?: string;
}

interface SortableTableProps<T extends object> {
  rows: T[];
  defaultSort: keyof T;
  defaultDir?: "asc" | "desc";
  columns: Column<T>[];
  rowKey: (row: T) => string;
  emptyState?: ReactNode;
  rowClass?: (row: T) => string;
}

export function SortableTable<T extends object>({
  rows,
  defaultSort,
  defaultDir = "desc",
  columns,
  rowKey,
  emptyState,
  rowClass,
}: SortableTableProps<T>) {
  const [sortKey, setSortKey] = useState<keyof T>(defaultSort);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultDir);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "desc" ? bv - av : av - bv;
      }
      const as = String(av);
      const bs = String(bv);
      return sortDir === "desc" ? bs.localeCompare(as) : as.localeCompare(bs);
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function handleSort(key: keyof T) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  if (!rows.length && emptyState) return <>{emptyState}</>;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-xs text-[var(--muted-foreground)]">
            {columns.map((col) => {
              const sortable = col.sortable !== false;
              const isActive = sortable && sortKey === col.key;
              const ArrowIcon = isActive
                ? sortDir === "desc"
                  ? ArrowDown
                  : ArrowUp
                : ArrowUpDown;
              return (
                <th
                  key={String(col.key)}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={sortable ? () => handleSort(col.key) : undefined}
                  className={`pb-2 pr-3 ${
                    col.align === "right" ? "text-right" : "text-left"
                  } font-normal select-none ${
                    sortable ? "cursor-pointer hover:text-[var(--foreground)]" : ""
                  }`}
                >
                  {sortable ? (
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      <ArrowIcon
                        className={`h-3 w-3 ${
                          isActive ? "text-[var(--foreground)]" : "opacity-30"
                        }`}
                      />
                    </span>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              className={rowClass ? rowClass(row) : ""}
            >
              {columns.map((col) => (
                <td
                  key={String(col.key)}
                  className={`py-2 pr-3 ${
                    col.align === "right" ? "text-right tabular-nums" : ""
                  }`}
                >
                  {col.formatter ? col.formatter(row) : String(row[col.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
