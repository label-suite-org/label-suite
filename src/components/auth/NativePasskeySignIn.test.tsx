// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativePasskeySignIn } from "./NativePasskeySignIn";
const oauth = vi.hoisted(() => vi.fn());
vi.mock("../../lib/auth-client", () => ({ signIn: { oauth2: oauth, passkey: vi.fn() } }));
let root: Root;
let host: HTMLDivElement;
async function render(complete = false) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<NativePasskeySignIn challenge={"a".repeat(43)} state={"b".repeat(43)} ssoEnabled complete={complete} />));
}
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("native Pocket ID handoff", () => {
  it("keeps the native proof in the fixed OAuth return URL and does not complete failed OAuth", async () => {
    oauth.mockResolvedValue({ error: { message: "denied" } });
    await render();
    await act(async () => host.querySelector("button")!.click());
    const options = oauth.mock.calls[0][0];
    expect(options.providerId).toBe("pocket-id");
    const callback = new URL(options.callbackURL, "https://suite.test");
    expect(callback.pathname).toBe("/native-sign-in");
    expect(callback.searchParams.get("challenge")).toBe("a".repeat(43));
    expect(callback.searchParams.get("state")).toBe("b".repeat(43));
    expect(callback.searchParams.get("complete")).toBe("1");
    expect(new URL(options.errorCallbackURL, "https://suite.test").searchParams.has("complete")).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Pocket ID sign-in was not completed");
  });
  it("requires an authenticated server session after OAuth before returning to the app", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false }); vi.stubGlobal("fetch", fetchMock);
    await render(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/native/browser-sign-in", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "authorize", challenge: "a".repeat(43), state: "b".repeat(43) }) }));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Unable to return to the app");
  });
});
