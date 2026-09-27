import type { ProjectFundingCoverage } from "../../server/funding-coverage-core";
import { formatCoverageMoney } from "./money";

export { formatCoverageMoney } from "./money";

/**
 * The one way funding coverage is rendered everywhere:
 * solid = confirmed, striped = weighted pipeline, empty = gap.
 * Budget, Grants & funding, and the dashboard all use this component so the
 * numbers and their meaning never drift between pages.
 */

const STRIPES =
  "repeating-linear-gradient(135deg, rgb(217 119 6 / 0.75) 0px, rgb(217 119 6 / 0.75) 4px, rgb(253 230 138 / 0.9) 4px, rgb(253 230 138 / 0.9) 8px)";

export default function CoverageBar({
  coverage,
  compact = false,
  className = "",
}: {
  coverage: ProjectFundingCoverage;
  compact?: boolean;
  className?: string;
}) {
  const { budgetTotal, confirmed, pipelineWeighted, gap, currency, confirmedPercent, pipelinePercent } = coverage;
  const gapPercent = Math.max(0, 100 - confirmedPercent - pipelinePercent);
  const label = `${formatCoverageMoney(confirmed, currency)} confirmed, ${formatCoverageMoney(pipelineWeighted, currency)} weighted pipeline, ${formatCoverageMoney(gap, currency)} gap of ${formatCoverageMoney(budgetTotal, currency)} planned`;

  return (
    <div className={`min-w-0 ${className}`}>
      <div className={`overflow-hidden bg-muted ${compact ? "h-1.5" : "h-2"}`} role="img" aria-label={label} title={label}>
        <div className="flex h-full">
          <div className="bg-emerald-600" style={{ width: `${confirmedPercent}%` }} />
          <div style={{ width: `${pipelinePercent}%`, background: STRIPES }} />
        </div>
      </div>
      {(coverage.excludedCurrencyCount ?? 0) > 0 && <p className="mt-2 text-xs text-amber-800">{coverage.excludedCurrencyCount} grant amount(s) excluded: currency differs from this project. Confirm the project allocation and conversion before counting them.</p>}
      {!compact && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2 bg-emerald-600" aria-hidden />
            Confirmed <strong className="font-medium tabular-nums text-foreground">{formatCoverageMoney(confirmed, currency)}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2" style={{ background: STRIPES }} aria-hidden />
            Pipeline (weighted) <strong className="font-medium tabular-nums text-foreground">{formatCoverageMoney(pipelineWeighted, currency)}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2 bg-muted ring-1 ring-inset ring-border" aria-hidden />
            Gap <strong className={`font-medium tabular-nums ${gap > 0 ? "text-foreground" : "text-emerald-700"}`}>{formatCoverageMoney(gap, currency)}</strong>
          </span>
          <span className="ml-auto tabular-nums">{gapPercent > 0 ? `${confirmedPercent}% covered` : "Fully covered"} · plan {formatCoverageMoney(budgetTotal, currency)}</span>
        </div>
      )}
    </div>
  );
}
