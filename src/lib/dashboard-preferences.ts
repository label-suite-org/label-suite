import { z } from "zod";

export const DASHBOARD_INDICATOR_IDS = [
  "release_readiness",
  "catalog_issues",
  "net_revenue",
  "unpaid_statements",
  "due_tasks",
  "analytics_health",
] as const;

export const DASHBOARD_SECTION_IDS = [
  "releases",
  "tasks",
  "catalog",
  "analytics",
  "royalties",
  "funding",
] as const;

export type DashboardIndicatorId = typeof DASHBOARD_INDICATOR_IDS[number];
export type DashboardSectionId = typeof DASHBOARD_SECTION_IDS[number];

export interface DashboardPreferences {
  schemaVersion: 1;
  pinnedIndicatorIds: DashboardIndicatorId[];
  sectionOrder: DashboardSectionId[];
  hiddenSectionIds: DashboardSectionId[];
}

const indicatorIdSchema = z.enum(DASHBOARD_INDICATOR_IDS);
const sectionIdSchema = z.enum(DASHBOARD_SECTION_IDS);

export const dashboardPreferencesInputSchema = z.object({
  schemaVersion: z.literal(1),
  pinnedIndicatorIds: z.array(indicatorIdSchema).max(3),
  sectionOrder: z.array(sectionIdSchema).length(DASHBOARD_SECTION_IDS.length),
  hiddenSectionIds: z.array(sectionIdSchema),
}).superRefine((value, context) => {
  requireUnique(value.pinnedIndicatorIds, "pinnedIndicatorIds", context);
  requireUnique(value.sectionOrder, "sectionOrder", context);
  requireUnique(value.hiddenSectionIds, "hiddenSectionIds", context);

  if (new Set(value.sectionOrder).size !== DASHBOARD_SECTION_IDS.length) {
    context.addIssue({
      code: "custom",
      path: ["sectionOrder"],
      message: "sectionOrder must contain every dashboard section exactly once",
    });
  }
});

export function defaultDashboardPreferences(): DashboardPreferences {
  return {
    schemaVersion: 1,
    pinnedIndicatorIds: ["release_readiness", "due_tasks", "catalog_issues"],
    sectionOrder: ["releases", "tasks", "catalog", "analytics", "royalties", "funding"],
    hiddenSectionIds: ["royalties", "funding"],
  };
}

export function normalizeDashboardPreferences(
  input: unknown,
  options: { stored?: boolean } = {},
): DashboardPreferences {
  if (options.stored && storedSchemaVersion(input) !== 1) {
    return defaultDashboardPreferences();
  }

  const parsed = dashboardPreferencesInputSchema.parse(input);
  return {
    schemaVersion: 1,
    pinnedIndicatorIds: [...parsed.pinnedIndicatorIds],
    sectionOrder: [...parsed.sectionOrder],
    hiddenSectionIds: [...parsed.hiddenSectionIds],
  };
}

function requireUnique(
  values: readonly string[],
  path: string,
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path: [path], message: `${path} must not contain duplicates` });
  }
}

function storedSchemaVersion(input: unknown): unknown {
  return typeof input === "object" && input !== null && "schemaVersion" in input
    ? input.schemaVersion
    : undefined;
}
