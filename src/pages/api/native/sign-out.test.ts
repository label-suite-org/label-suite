import { describe, expect, it, vi } from "vitest";

const { bearer, resolved, where } = vi.hoisted(() => ({ bearer: vi.fn<() => string | null>(() => crypto.randomUUID()), resolved: vi.fn(), where: vi.fn() }));
vi.mock("../../../lib/native-session", () => ({ bearerToken: bearer, getNativeSession: resolved }));
vi.mock("../../../lib/db", () => ({ db: { delete: vi.fn(() => ({ where })) } }));
vi.mock("../../../db/auth-schema", () => ({ sessions: { id: "id" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((column, value) => ({ column, value })) }));
import { POST } from "./sign-out";

describe("native sign-out", () => {
  it("deletes only the resolved presented session", async () => {
    const sessionID = crypto.randomUUID();
    resolved.mockResolvedValueOnce({ session: { id: sessionID } });
    const response = await POST({ request: new Request("https://example.test/api/native/sign-out", { method: "POST" }) } as never);
    expect(response.status).toBe(204); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(where).toHaveBeenCalledWith({ column: "id", value: sessionID });
  });
  it("rejects missing or invalid native bearer sessions", async () => {
    bearer.mockReturnValueOnce(null); resolved.mockResolvedValueOnce(null);
    expect((await POST({ request: new Request("https://example.test") } as never)).status).toBe(401);
    expect((await POST({ request: new Request("https://example.test") } as never)).status).toBe(401);
  });
});
