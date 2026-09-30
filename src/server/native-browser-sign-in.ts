import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { sessions, verifications } from "../db/auth-schema";
import { db } from "../lib/db";
import { HttpError } from "./errors";

const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
const key = (code: string) => `native-sign-in:${digest(code)}`;
export const validBrowserNonce = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

export async function issueBrowserCode(sessionId: string, challenge: string) {
  const code = randomBytes(32).toString("base64url");
  await db.insert(verifications).values({ id: randomUUID(), identifier: key(code), value: JSON.stringify({ sessionId, challenge }), expiresAt: new Date(Date.now() + 120_000) });
  return code;
}

export async function exchangeBrowserCode(code: string, verifier: string) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const row = (await tx.select().from(verifications).where(and(eq(verifications.identifier, key(code)), gt(verifications.expiresAt, now))).limit(1))[0];
    if (!row) throw new HttpError("Sign-in expired. Please try again.", 401);
    const saved = JSON.parse(row.value) as { sessionId: string; challenge: string };
    if (saved.challenge !== digest(verifier)) throw new HttpError("Invalid sign-in proof", 401);
    const source = (await tx.select().from(sessions).where(and(eq(sessions.id, saved.sessionId), gt(sessions.expiresAt, now))).limit(1).for("update"))[0];
    if (!source) throw new HttpError("Sign-in expired. Please try again.", 401);
    // DELETE RETURNING makes concurrent redemption single-use, inside the session transaction.
    const consumed = await tx.delete(verifications).where(eq(verifications.id, row.id)).returning({ id: verifications.id });
    if (consumed.length !== 1) throw new HttpError("Sign-in already used", 401);
    const token = randomBytes(32).toString("base64url");
    await tx.insert(sessions).values({ id: randomUUID(), userId: source.userId, token, expiresAt: source.expiresAt, createdAt: now, updatedAt: now });
    return { token, user: { id: source.userId } };
  });
}
