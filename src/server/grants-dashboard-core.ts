export type FundingInput = { status: string | null; amount: number | null };
export type ProjectFundingInput = { id: string; name: string; status: string | null; currency: string | null; totalPlanned: number | null; funding: FundingInput[]; purposes: string[] };
export type GrantOpportunityInput = { id: string; name: string; category: string | null; status: string | null; deadline: string | null; maxAmount: number | null; currency: string | null };
export type GrantApplicationInput = { projectId: string | null; grantId: string | null };

const normalize = (value: string | null) => (value ?? "").trim().toLowerCase();

export function buildGrantsDashboard(input: { projects: ProjectFundingInput[]; grants: GrantOpportunityInput[]; applications: GrantApplicationInput[] }, today: string) {
  const activeGrants = input.grants.filter((grant) => ["open", "research", "planned"].includes(normalize(grant.status)) && (!grant.deadline || grant.deadline >= today));
  const projects = input.projects.map((project) => {
    const fundingGap = Math.max((project.totalPlanned ?? 0) - project.funding.filter((source) => ["confirmed", "granted"].includes(normalize(source.status))).reduce((sum, source) => sum + Number(source.amount ?? 0), 0), 0);
    const pursued = new Set(input.applications.filter((application) => application.projectId === project.id).map((application) => application.grantId));
    const topMatch = activeGrants
      .filter((grant) => !pursued.has(grant.id))
      .map((grant) => ({ ...grant, score: project.purposes.some((purpose) => normalize(grant.category).includes(normalize(purpose)) || normalize(purpose).includes(normalize(grant.category))) ? 1 : 0 }))
      .sort((a, b) => b.score - a.score || (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31"))[0] ?? null;
    return { ...project, fundingGap, topMatch, purposes: project.purposes.filter(Boolean).slice(0, 3) };
  }).sort((a, b) => (normalize(a.status) === "active" ? 0 : 1) - (normalize(b.status) === "active" ? 0 : 1) || b.fundingGap - a.fundingGap);
  return { projects, kpis: { fundingGap: projects.reduce((sum, project) => sum + project.fundingGap, 0), priorityProjects: projects.filter((project) => project.fundingGap > 0).length, upcomingDeadlines: activeGrants.filter((grant) => grant.deadline && grant.deadline <= new Date(new Date(today).getTime() + 30 * 86400000).toISOString().slice(0, 10)).length } };
}
