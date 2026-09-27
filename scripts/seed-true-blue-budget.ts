import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq, sql } from "drizzle-orm";
import {
  budget_categories,
  budget_line_items,
  budget_projects,
  funding_sources,
} from "../src/db/schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const ORG_ID = "true-nature";
const ARTIST_ID = "recZSDkbhOcn5g6BH"; // True Blue (verified via label_suite.artists)
const RELEASE_ID = "rel-nouveau-boho-2027";

// ─── Production categories ──────────────────────────────
const productionCategories = [
  { name: "Pre-production / arrangements / demos", type: "production", planned: 3500, phase: "pre_pro", month: "2026-09" },
  { name: "Producer pool (4 × $1,500)", type: "production", planned: 6000, phase: "recording", month: "2026-10" },
  { name: "Studio rental / tracking rooms", type: "production", planned: 2500, phase: "recording", month: "2026-10" },
  { name: "Recording engineer", type: "production", planned: 2000, phase: "recording", month: "2026-10" },
  { name: "Session musicians / additional players", type: "production", planned: 1000, phase: "recording", month: "2026-10" },
  { name: "Vocal production / editing / comping", type: "production", planned: 1000, phase: "post_pro", month: "2026-11" },
  { name: "Programming / sound design / sample-clearance buffer", type: "production", planned: 2000, phase: "post_pro", month: "2026-11" },
  { name: "Mixing (12 tracks × $500)", type: "production", planned: 6000, phase: "post_pro", month: "2026-11" },
  { name: "Mastering", type: "production", planned: 1500, phase: "post_pro", month: "2026-12" },
  { name: "Artwork / album package core assets", type: "production", planned: 3000, phase: "post_pro", month: "2026-11" },
  { name: "Travel / lodging / meals during recording", type: "production", planned: 1800, phase: "recording", month: "2026-10" },
  { name: "Admin / ops / AI tooling / delivery", type: "production", planned: 2000, phase: "recording", month: "2026-10" },
  { name: "Manager fee (20% × $60k direct advance)", type: "production", planned: 12000, phase: "recording", month: "2026-10" },
  { name: "Legal / attorney fees", type: "production", planned: 3000, phase: "recording", month: "2026-10" },
  { name: "Production contingency (locked)", type: "production_contingency", planned: 12700, phase: "post_pro", month: "2027-02", lock: "locked" as const },
];

// ─── Marketing categories ───────────────────────────────
const marketingCategories = [
  { name: "Strategy / creative direction / campaign management", type: "marketing", planned: 3200, phase: "setup", month: "2027-01" },
  { name: "Content production (Mystique DIY + 2-day content shoot)", type: "marketing", planned: 8000, phase: "singles", month: "2027-02", tag: "stem_review" },
  { name: "PR / press / radio plugging", type: "marketing", planned: 7200, phase: "singles", month: "2027-02", tag: "stem_review" },
  { name: "Digital ads (city-targeted saturation)", type: "marketing", planned: 6800, phase: "singles", month: "2027-02", tag: "stem_review" },
  { name: "Influencer / creator seeding", type: "marketing", planned: 3200, phase: "singles", month: "2027-02", tag: "stem_review" },
  { name: "Release events / listening session / activation", type: "marketing", planned: 2800, phase: "release_week", month: "2027-03" },
  { name: "Physical / merch / promo mailers", type: "marketing", planned: 4000, phase: "release_week", month: "2027-03", tag: "stem_review" },
  { name: "Marketing contingency / opportunity fund (locked)", type: "marketing_contingency", planned: 4800, phase: "post_release", month: "2027-04", lock: "locked" as const },
];

const productionSum = productionCategories.reduce((s, c) => s + c.planned, 0);
const marketingSum = marketingCategories.reduce((s, c) => s + c.planned, 0);
console.log(`Production: $${productionSum.toLocaleString()}`);
console.log(`Marketing:  $${marketingSum.toLocaleString()}`);
console.log(`Total:      $${(productionSum + marketingSum).toLocaleString()}`);

async function main() {
  // Idempotent: remove any prior True Blue seed
  await db.execute(sql`delete from label_suite.budget_line_items where org_id=${ORG_ID} and project_id in (select id from label_suite.budget_projects where name=${"True Blue Next Record"})`);
  await db.execute(sql`delete from label_suite.funding_sources where org_id=${ORG_ID} and project_id in (select id from label_suite.budget_projects where name=${"True Blue Next Record"})`);
  await db.delete(budget_projects).where(and(eq(budget_projects.org_id, ORG_ID), eq(budget_projects.name, "True Blue Next Record")));

  // Insert release row first so the FK from budget_projects is satisfied (idempotent)
  await db.execute(sql`
    insert into label_suite.releases (id, org_id, artist_id, title, status, release_date)
    values (${RELEASE_ID}, ${ORG_ID}, ${ARTIST_ID}, ${"Nouveau Boho"}, ${"in_production"}, ${"2027-03-01"})
    on conflict (id) do update set title = excluded.title
  `);

  // Insert project
  const projectId = "tb-next-record-2027";
  await db.insert(budget_projects).values({
    id: projectId,
    org_id: ORG_ID,
    name: "Nouveau Boho",
    artist_id: ARTIST_ID,
    release_id: RELEASE_ID,
    status: "planning",
    currency: "USD",
    total_planned: productionSum + marketingSum,
    baseline_funding: 100000,
    track_count: 12,
    singles_count: 4,
    notes: "12-track record, 4 singles rollout. Core producers: Malthe, Yunus, Raven, Jake. STEM $100k baseline. Manager 20% × $60k = $12k + legal $3k sits inside production/admin; both are part of the $85k+15k=$100k committed plan. Contingency locked.",
  });

  // Funding sources
  const fundingSeeds = [
    { id: "fs-stem-base", name: "STEM distribution/label-services", type: "advance", status: "confirmed", planned: 100000, confirmed: 100000, restricted: "production+marketing", funder: "STEM", notes: "Schedule B: $60k direct advance + $40k marketing drawdown paid to approved vendors. STEM reviews marketing budget + vendor invoices." },
    { id: "fs-koda-prod", name: "KODA Kultur Udgivelsespuljen (production)", type: "grant", status: "pending", planned: 12000, confirmed: 0, restricted: "production", funder: "KODA", notes: "Apply for recording/mix/master/musician/studio if timeline fits and project not already released." },
    { id: "fs-koda-pr", name: "KODA Kultur PR/Promotion + Akut Markedspulje", type: "grant", status: "pending", planned: 7000, confirmed: 0, restricted: "marketing", funder: "KODA", notes: "Use as separate phase after production grant. Split phases to avoid duplicate KODA support." },
    { id: "fs-mxd", name: "MXD export/content marketing (complement STEM)", type: "grant", status: "research", planned: 25000, confirmed: 0, restricted: "export", funder: "MXD", deadline: "monthly 15th", notes: "Frame as export-market content activation (US/UK/FR/DE), not generic video. Should complement STEM, not replace it." },
    { id: "fs-direct2fan", name: "Direct-to-fan / patrons / brand partners", type: "patron", status: "research", planned: 30000, confirmed: 0, restricted: "flexible", funder: "Direct", notes: "Preorder limited vinyl bundle, founding supporter circle, tasteful brand partner." },
  ];

  for (const fs of fundingSeeds) {
    await db.insert(funding_sources).values({
      id: fs.id,
      org_id: ORG_ID,
      project_id: projectId,
      name: fs.name,
      type: fs.type,
      status: fs.status,
      amount_planned: fs.planned,
      amount_confirmed: fs.confirmed,
      restricted_to: fs.restricted,
      funder: fs.funder,
      deadline: fs.deadline ?? null,
      reporting_required: fs.type === "grant" ? 1 : 0,
      notes: fs.notes,
    });
  }

  // Categories
  const catSeeds = [
    { id: "cat-pre-pro", name: "Pre-production / arrangements / demos", type: "production" },
    { id: "cat-producer", name: "Producer pool", type: "production" },
    { id: "cat-studio", name: "Studio rental / tracking", type: "production" },
    { id: "cat-engineer", name: "Recording engineer", type: "production" },
    { id: "cat-musicians", name: "Session musicians", type: "production" },
    { id: "cat-vocal", name: "Vocal production / editing", type: "production" },
    { id: "cat-sound", name: "Programming / sound design / clearance", type: "production" },
    { id: "cat-mixing", name: "Mixing", type: "production" },
    { id: "cat-mastering", name: "Mastering", type: "production" },
    { id: "cat-artwork", name: "Artwork / album package", type: "production" },
    { id: "cat-travel", name: "Travel / lodging / meals", type: "production" },
    { id: "cat-admin", name: "Admin / ops / AI tooling / delivery", type: "production" },
    { id: "cat-manager", name: "Manager fee (20% × $60k)", type: "production" },
    { id: "cat-legal", name: "Legal / attorney fees", type: "production" },
    { id: "cat-prod-contingency", name: "Production contingency (locked)", type: "production_contingency" },
    { id: "cat-strategy", name: "Strategy / campaign management", type: "marketing" },
    { id: "cat-content", name: "Content production", type: "marketing" },
    { id: "cat-pr", name: "PR / press / radio plugging", type: "marketing" },
    { id: "cat-ads", name: "Digital ads", type: "marketing" },
    { id: "cat-influencer", name: "Influencer / creator seeding", type: "marketing" },
    { id: "cat-events", name: "Release events / activation", type: "marketing" },
    { id: "cat-physical", name: "Physical / merch / promo mailers", type: "marketing" },
    { id: "cat-mkt-contingency", name: "Marketing contingency / opportunity fund (locked)", type: "marketing_contingency" },
  ];

  for (const c of catSeeds) {
    await db.insert(budget_categories).values({
      id: c.id,
      org_id: ORG_ID,
      name: c.name,
      type: c.type,
    }).onConflictDoNothing();
  }

  // Production lines
  for (const [idx, line] of productionCategories.entries()) {
    const cleanCatId = productionCatMap(line.name);
    await db.insert(budget_line_items).values({
      id: `tb-prod-${idx + 1}`,
      org_id: ORG_ID,
      project_id: projectId,
      category_id: cleanCatId,
      name: line.name,
      amount: line.planned,
      planned_amount: line.planned,
      forecast_amount: line.planned,
      committed_amount: 0,
      paid_amount: 0,
      phase: line.phase,
      spend_month: line.month,
      status: "pending",
      lock_status: line.lock ?? "open",
      funding_source_id: line.type === "production_contingency" ? null : "fs-stem-base",
    });
  }

  // Marketing lines
  for (const [idx, line] of marketingCategories.entries()) {
    const cleanCatId = marketingCatMap(line.name);
    await db.insert(budget_line_items).values({
      id: `tb-mkt-${idx + 1}`,
      org_id: ORG_ID,
      project_id: projectId,
      category_id: cleanCatId,
      name: line.name,
      amount: line.planned,
      planned_amount: line.planned,
      forecast_amount: line.planned,
      committed_amount: 0,
      paid_amount: 0,
      phase: line.phase,
      spend_month: line.month,
      status: "pending",
      lock_status: line.lock ?? "open",
      eligibility_tag: line.tag ?? null,
      funding_source_id: "fs-stem-base",
    });
  }

  console.log("✅ Seed complete");
  console.log(`   Project: ${projectId}`);
  console.log(`   Funding sources: 5 (1 confirmed, 4 pending/research)`);
  console.log(`   Budget lines: ${productionCategories.length + marketingCategories.length}`);
}

function productionCatMap(name: string): string {
  if (name.startsWith("Pre-production")) return "cat-pre-pro";
  if (name.startsWith("Producer")) return "cat-producer";
  if (name.startsWith("Studio")) return "cat-studio";
  if (name.startsWith("Recording engineer")) return "cat-engineer";
  if (name.startsWith("Session")) return "cat-musicians";
  if (name.startsWith("Vocal")) return "cat-vocal";
  if (name.startsWith("Programming")) return "cat-sound";
  if (name.startsWith("Mixing")) return "cat-mixing";
  if (name.startsWith("Mastering")) return "cat-mastering";
  if (name.startsWith("Artwork")) return "cat-artwork";
  if (name.startsWith("Travel")) return "cat-travel";
  if (name.startsWith("Admin")) return "cat-admin";
  if (name.startsWith("Manager")) return "cat-manager";
  if (name.startsWith("Legal")) return "cat-legal";
  if (name.startsWith("Production contingency")) return "cat-prod-contingency";
  return "cat-pre-pro";
}

function marketingCatMap(name: string): string {
  if (name.startsWith("Strategy")) return "cat-strategy";
  if (name.startsWith("Content")) return "cat-content";
  if (name.startsWith("PR")) return "cat-pr";
  if (name.startsWith("Digital")) return "cat-ads";
  if (name.startsWith("Influencer")) return "cat-influencer";
  if (name.startsWith("Release events")) return "cat-events";
  if (name.startsWith("Physical")) return "cat-physical";
  if (name.startsWith("Marketing contingency")) return "cat-mkt-contingency";
  return "cat-strategy";
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
