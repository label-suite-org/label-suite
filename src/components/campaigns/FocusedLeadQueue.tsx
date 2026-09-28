import type { CampaignOutreachWorkspaceData } from "../../server/campaign-outreach";

import { Button } from "@/components/ui/button";
type Lead = CampaignOutreachWorkspaceData["leads"][number];
type Queue = CampaignOutreachWorkspaceData["queue"];

type Props = {
  queue: Queue;
  selectedLeadId: string | null;
  onSelectLead: (leadId: string) => void;
  disabled?: boolean;
  idPrefix?: string;
};

const GROUPS = [
  ["now", "Now"],
  ["followUp", "Follow-up"],
  ["waiting", "Waiting"],
  ["completed", "Completed"],
] as const;

export default function FocusedLeadQueue({ queue, selectedLeadId, onSelectLead, idPrefix = "focused", disabled = false }: Props) {
  return (
    <nav aria-label="Focused lead queue" className="divide-y divide-border border-y border-border">
      {GROUPS.map(([key, label]) => (
        <section key={key} aria-labelledby={`${idPrefix}-queue-${key}`} className="py-3">
          <div className="flex items-center justify-between px-3">
            <h3 id={`${idPrefix}-queue-${key}`} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</h3>
            <span className="text-[11px] tabular-nums text-muted-foreground">{queue[key].length}</span>
          </div>
          <div className="mt-1 space-y-0.5 px-1.5">
            {queue[key].map((lead) => (
              <LeadButton key={lead.id} lead={lead} selected={lead.id === selectedLeadId} disabled={disabled} onSelect={() => onSelectLead(lead.id)} />
            ))}
            {queue[key].length === 0 && <p className="px-1.5 py-2 text-xs text-muted-foreground">No leads</p>}
          </div>
        </section>
      ))}
    </nav>
  );
}

function LeadButton({ lead, selected, disabled, onSelect }: { lead: Lead; selected: boolean; disabled: boolean; onSelect: () => void }) {
  return (
    <Button
      variant="ghost"
      type="button"
      disabled={disabled}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={`w-full border-l-2 px-2 py-2 text-left ${selected ? "border-[#4f6f9f] bg-[#4f6f9f]/10" : "border-transparent hover:bg-muted/50"}`}
    >
      <span className="block truncate text-sm font-medium">{lead.target_name}</span>
      <span className={`mt-0.5 flex items-center justify-between gap-2 text-[11px] ${selected ? "text-foreground" : "text-muted-foreground"}`}>
        <span className="truncate capitalize">{lead.pipeline_stage}</span>
        <span className="tabular-nums">{lead.priority_score}/10</span>
      </span>
    </Button>
  );
}
