export type ResourceAttention = {
  orphaned: boolean;
  missing: boolean;
  unreviewed: boolean;
};

export type ResourceAttentionFilter = keyof ResourceAttention | "all" | "needs_attention";

export function getResourceAttention(input: { hasOwner: boolean; fileLink?: string | null; reviewed: boolean }): ResourceAttention {
  return {
    orphaned: !input.hasOwner,
    missing: !input.fileLink,
    unreviewed: !input.reviewed,
  };
}

export function matchesResourceAttentionFilter(attention: ResourceAttention, filter: ResourceAttentionFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs_attention") return attention.orphaned || attention.missing || attention.unreviewed;
  return attention[filter];
}
