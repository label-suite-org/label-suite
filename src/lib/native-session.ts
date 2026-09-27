import { eq } from "drizzle-orm";
import { sessions, users } from "../db/auth-schema";
import { db } from "./db";
export { bearerToken } from "./native-auth";

/** Resolve a Better Auth session from the bearer token used by native clients. */
export async function getNativeSession(token: string) {
  const value = token.trim();
  if (!value || value.length > 512) return null;
  const row = (await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, value))
    .limit(1))[0];
  if (!row || row.session.expiresAt <= new Date()) return null;
  return row;
}
