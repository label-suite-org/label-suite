import { db } from "./db";
import { email_templates } from "../db/schema";

// ─── Email Templates Seed ────────────────────────────────
const EMAIL_TEMPLATES = [
  {
    id: "seed-tpl-01",
    name: "Radio Pitch — Initial Outreach",
    subject: "{{release_title}} by {{campaign_name}} — Radio Pitch",
    body: `<p>Hi {{dj_name}},</p>
<p>I'm reaching out from <strong>{{campaign_name}}</strong> about our new release <strong>{{release_title}}</strong>. We'd love to get it in rotation on <strong>{{station_name}}</strong> ({{call_sign}}).</p>
<p>Let us know if you'd like a press kit or a listen link!</p>
<p>Thanks,<br/>True Nature</p>`,
    description: "Initial outreach to a radio station DJ for a new release",
    is_default: true,
  },
  {
    id: "seed-tpl-02",
    name: "Follow-up",
    subject: "Re: {{release_title}} — Quick Follow-up",
    body: `<p>Hi {{dj_name}},</p>
<p>Just following up on my earlier email about <strong>{{release_title}}</strong> — wondering if you've had a chance to give it a spin on {{station_name}}?</p>
<p>Happy to send over anything you need.</p>
<p>Cheers,<br/>True Nature</p>`,
    description: "Follow up with a radio station DJ after initial outreach",
    is_default: true,
  },
  {
    id: "seed-tpl-03",
    name: "Thank You / Play Confirm",
    subject: "Thank You for Playing {{release_title}} on {{station_name}}!",
    body: `<p>Hi {{dj_name}},</p>
<p>Thank you so much for giving <strong>{{release_title}}</strong> a spin on <strong>{{station_name}}</strong> ({{call_sign}})!</p>
<p>The artist is thrilled and we really appreciate the support from your audience in {{city}}.</p>
<p>We'll keep you posted on future releases.</p>
<p>Warm regards,<br/>True Nature</p>`,
    description: "Thank-you email to a DJ after a confirmed play",
    is_default: true,
  },
];

async function seedEmailTemplates() {
  console.log("📧 Seeding email templates...");
  const orgId = "true-nature";
  let count = 0;

  for (const tpl of EMAIL_TEMPLATES) {
    try {
      await db.insert(email_templates).values({
        id: tpl.id,
        org_id: orgId,
        name: tpl.name,
        subject: tpl.subject,
        body: tpl.body,
        description: tpl.description,
        is_default: tpl.is_default,
      }).onConflictDoNothing({ target: email_templates.id });
      count++;
    } catch (err) {
      console.error(`  ⚠️  Failed to insert template "${tpl.name}":`, (err as Error).message);
    }
  }
  console.log(`   ✅ ${count} email templates seeded (upsert-safe)`);
}

// ─── Main seed function ──────────────────────────────────
export async function main() {
  console.log("Seeding Label Suite operational defaults...\n");

  await seedEmailTemplates();
  console.log("\nSeeding complete.");
  console.log("Demo catalog data is intentionally not seeded by default.");

  return { seeded: ["email_templates"] };
}

// ─── Run if called directly ──────────────────────────────
if (import.meta.url === new URL(import.meta.url).href || process.argv[1]?.endsWith("seed.ts")) {
  main()
    .then(() => {
      console.log("Seed script finished successfully.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Seed script failed:", err);
      process.exit(1);
    });
}
