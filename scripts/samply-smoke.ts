import "dotenv/config";
import { getSamplyAvailability, listSamplyProjects } from "../src/server/samply";

async function main() {
  const orgId = process.env.SAMPLY_ORG_ID?.trim() || "true-nature";
  const availability = getSamplyAvailability(orgId);

  if (!availability.configured) {
    const reason = availability.reason === "org_mismatch"
      ? `configured for org ${availability.configuredOrgId}, not ${orgId}`
      : "missing SAMPLY_API_TOKEN";
    throw new Error(`Samply is not configured for ${orgId}: ${reason}`);
  }

  const projects = await listSamplyProjects(orgId);
  console.log(`Samply OK for org ${orgId}`);
  console.log(`Base URL: ${availability.baseUrl}`);
  console.log(`Projects: ${projects.length}`);
  for (const project of projects.slice(0, 5)) {
    console.log(`- ${project.name} (${project.id})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
