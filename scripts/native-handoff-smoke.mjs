// Run after npm run build with DATABASE_URL pointing to a disposable local *_fixture database.
// Starts its own built server; never attaches to a potentially production-connected preview.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) && database.pathname.endsWith("_fixture"), "Disposable local fixture database required");
const reservation = createServer();
await new Promise((resolve, reject) => reservation.once("error", reject).listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["dist/server/entry.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, DATABASE_URL: database.toString(), HOST: "127.0.0.1", PORT: String(port), PUBLIC_SITE_URL: origin,
    BETTER_AUTH_SECRET: randomUUID() + randomUUID(), BETTER_AUTH_TRUSTED_ORIGINS: origin, APNS_ENABLED: "false" },
  stdio: ["ignore", "pipe", "pipe"],
});
let ready = false;
server.stdout.on("data", chunk => { if (chunk.toString().includes(`:${port}`)) ready = true; });
// Do not emit server logs: auth failure diagnostics can include request metadata.
server.stderr.resume();
const sql = postgres(database.toString());
const org = `handoff-smoke-${randomUUID()}`, email = `${org}@example.test`;
let user;
try {
  for (let attempt = 0; !ready && attempt < 200; attempt++) {
    assert.equal(server.exitCode, null, "Built server exited before startup");
    await delay(100);
  }
  assert.ok(ready, "Built server did not start");
  const url = `${origin}/native-handoff?${new URLSearchParams({ workspaceId: org, operation: "integration-credentials" })}`;
  for (const [method, requestOrigin, status] of [["GET", null, 401], ["POST", "https://attacker.test", 403], ["POST", origin, 401]]) {
    const response = await fetch(url, { method, headers: requestOrigin ? { Origin: requestOrigin } : {}, redirect: "manual" });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("location"), null);
    assert.ok((await response.text()).includes(status === 403 ? "Cross-origin request denied" : "Sign in to the website"));
  }
  const signup = await fetch(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Handoff fixture", email, password: randomUUID() }) });
  assert.equal(signup.status, 200, "Disposable fixture signup failed");
  user = (await signup.json()).user.id;
  const cookie = signup.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.ok(cookie, "Fixture session missing");
  await sql`insert into label_suite.orgs(id,name,slug) values (${org},'Handoff target',${org})`;
  await sql`insert into label_suite.org_memberships(id,org_id,user_id,role) values (${org},${org},${user},'owner')`;
  let response = await fetch(url, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.ok((await response.text()).includes("Handoff target"));
  response = await fetch(url, { method: "POST", headers: { Cookie: cookie, Origin: origin }, redirect: "manual" });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/integrations");
  assert.ok(response.headers.get("set-cookie")?.includes(`label_suite_org_id=${org}`));
  await sql`update label_suite.org_memberships set role='member' where id=${org}`;
  response = await fetch(url, { method: "POST", headers: { Cookie: cookie, Origin: origin }, redirect: "manual" });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("location"), null);
  response = await fetch(url, { headers: { Cookie: "better-auth.session_token=invalid-fixture" }, redirect: "manual" });
  assert.equal(response.status, 401);
  console.log("Native handoff: rendered signed-out, invalid-session, cross-origin, exact-workspace confirmation and role-change checks passed.");
} finally {
  server.kill("SIGTERM");
  // Resolve fixture identity by unique email if signup succeeded but response processing failed.
  user ??= (await sql`select id from label_suite.user where email=${email}`)[0]?.id;
  await sql`delete from label_suite.org_memberships where org_id=${org}`;
  await sql`delete from label_suite.audit_logs where org_id=${org}`;
  await sql`delete from label_suite.orgs where id=${org}`;
  if (user) {
    await sql`delete from label_suite.session where "userId"=${user}`;
    await sql`delete from label_suite.account where "userId"=${user}`;
    await sql`delete from label_suite.user where id=${user}`;
  }
  await sql.end();
}
