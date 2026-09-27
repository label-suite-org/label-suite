import { describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/auth", () => ({ auth: { handler } }));
import { POST } from "./sign-in";

describe("native sign-in", () => {
  it("returns only the native session projection without forwarding cookies", async () => {
    const opaque = crypto.randomUUID();
    const password = crypto.randomUUID();
    const webCookie = crypto.randomUUID();
    handler.mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: "user-a" }, token: opaque }), { headers: { "set-cookie": `better-auth.session_token=${webCookie}; HttpOnly` } }));
    const response = await POST({ request: new Request("https://example.test/api/native/sign-in", { method: "POST", body: JSON.stringify({ email: "a@example.test", password }) }) } as never);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ user: { id: "user-a" }, token: opaque });
  });
  it("does not forward caller cookies or upstream failure cookies", async () => {
    const callerCookie = crypto.randomUUID();
    const callerToken = crypto.randomUUID();
    handler.mockResolvedValueOnce(new Response("denied", { status: 401, headers: { "set-cookie": `leak=${crypto.randomUUID()}` } }));
    const response = await POST({ request: new Request("https://example.test/api/native/sign-in", { method: "POST", headers: { Cookie: `caller=${callerCookie}`, Authorization: `Bearer ${callerToken}` }, body: "{}" }) } as never);
    expect(response.status).toBe(401); expect(response.headers.get("set-cookie")).toBeNull(); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const upstream = handler.mock.calls.at(-1)?.[0] as Request;
    expect(upstream.headers.get("cookie")).toBeNull(); expect(upstream.headers.get("authorization")).toBeNull();
  });
  it("returns a private no-store error when upstream does not issue a token", async () => {
    handler.mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: "user-a" } }), { status: 200 }));

    const response = await POST({ request: new Request("https://example.test/api/native/sign-in", { method: "POST", body: JSON.stringify({ email: "a@example.test", password: crypto.randomUUID() }) }) } as never);

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ error: "Native session was not issued" });
  });
});
