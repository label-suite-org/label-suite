/* @vitest-environment jsdom */

import { act, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_TOOL_SCOPES } from "../../lib/campaign-enrichment-local-tool-contract";
import type { ClientCapabilityMap } from "../../lib/client-capabilities";
import { LocalToolTokenSettings, type LocalToolTokenClientRecord } from "./LocalToolTokenSettings";
import { SettingsShell } from "./SettingsShell";

const initialToken: LocalToolTokenClientRecord = {
  id: "token-1",
  org_id: "org-1",
  user_id: "operator-1",
  name: "Studio MacBook",
  token_prefix: "lsmcp_token-1",
  scopes: [...LOCAL_TOOL_SCOPES],
  expires_at: "2026-09-09T12:00:00.000Z",
  revoked_at: null,
  last_used_at: "2026-08-10T13:00:00.000Z",
  created_at: "2026-08-10T12:00:00.000Z",
  updated_at: "2026-08-10T13:00:00.000Z",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-10T14:00:00.000Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("LocalToolTokenSettings", () => {
  it("exposes an explicit client-hydration boundary before browser automation mutates the form", async () => {
    const { container, root } = await renderSettings();

    expect(container.querySelector("[data-local-tool-token-hydrated='true']")).not.toBeNull();

    await act(async () => root.unmount());
  });

  it("renders only safe token metadata and the separate Codex OAuth boundary", () => {
    const html = renderToStaticMarkup(<LocalToolTokenSettings tokens={[initialToken]} onTokensChange={() => undefined} canMutate />);

    expect(html).toContain("Codex OAuth stays in Codex");
    expect(html).toContain("separate Label Suite token");
    expect(html).toContain("operator.diagnostics.read");
    expect(html).toContain("Studio MacBook");
    expect(html).toContain("lsmcp_token-1");
    expect(html).toContain("operator-1");
    expect(html).toContain("Last used");
    expect(html).toContain("Active");
    expect(html).not.toContain("secret_hash");
    expect(html).not.toContain("plaintext");
  });

  it("creates a named fixed-scope 30-day token and exposes the secret only until dismissal", async () => {
    const createdRecord: LocalToolTokenClientRecord = {
      ...initialToken,
      id: "token-2",
      name: "Tour laptop",
      token_prefix: "lsmcp_token-2",
      last_used_at: null,
    };
    const fetchMock = vi.fn(async () => jsonResponse({
      token: "lsmcp_token-2_one-time-secret",
      record: { ...createdRecord, secret_hash: "unsafe-server-hash" },
    }, 201));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container, root } = await renderSettings();

    await act(async () => setValue(container.querySelector('input[name="local-tool-token-name"]') as HTMLInputElement, "Tour laptop"));
    await act(async () => {
      buttonNamed(container, "Create 30-day token")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/settings/local-tool-tokens", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tour laptop", scopes: [...LOCAL_TOOL_SCOPES], expires_in_days: 30 }),
      signal: expect.any(AbortSignal),
    }));
    expect(container.textContent).toContain("lsmcp_token-2_one-time-secret");
    expect(container.textContent).toContain("Tour laptop");
    expect(container.textContent).not.toContain("unsafe-server-hash");

    await act(async () => buttonNamed(container, "Copy token")?.click());
    expect(writeText).toHaveBeenCalledWith("lsmcp_token-2_one-time-secret");

    await act(async () => buttonNamed(container, "I stored this")?.click());
    expect(container.textContent).not.toContain("lsmcp_token-2_one-time-secret");
    expect(container.textContent).toContain("lsmcp_token-2");

    await act(async () => root.unmount());
  });

  it("clears an undismissed one-time token when the component unmounts", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      token: "lsmcp_token-2_unmount-secret",
      record: { ...initialToken, id: "token-2", token_prefix: "lsmcp_token-2" },
    }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderSettings();

    await act(async () => setValue(container.querySelector('input[name="local-tool-token-name"]') as HTMLInputElement, "Temporary laptop"));
    await act(async () => {
      buttonNamed(container, "Create 30-day token")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("lsmcp_token-2_unmount-secret");

    await act(async () => root.unmount());
    expect(container.textContent).not.toContain("lsmcp_token-2_unmount-secret");
  });

  it("cancels a deferred create and ignores its response after unmount", async () => {
    const response = deferred<Response>();
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return response.promise;
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unhandledRejection = vi.fn();
    const tokenChange = vi.fn();
    window.addEventListener("unhandledrejection", unhandledRejection);
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderSettings(tokenChange);

    await act(async () => setValue(container.querySelector('input[name="local-tool-token-name"]') as HTMLInputElement, "Deferred laptop"));
    await act(async () => buttonNamed(container, "Create 30-day token")?.click());
    expect(fetchMock).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    response.resolve(jsonResponse({
      token: "lsmcp_deferred_secret-that-must-not-return",
      record: { ...initialToken, id: "token-deferred", name: "Deferred laptop", token_prefix: "lsmcp_deferred" },
    }, 201));
    await act(async () => { await response.promise; await Promise.resolve(); });

    expect(requestSignal?.aborted).toBe(true);
    expect(container.textContent).not.toContain("lsmcp_deferred_secret-that-must-not-return");
    expect(tokenChange).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(unhandledRejection).not.toHaveBeenCalled();
    window.removeEventListener("unhandledrejection", unhandledRejection);
  });

  it("revokes by token ID in client state and disables all mutation controls without operations.mutate", async () => {
    const revoked = { ...initialToken, revoked_at: "2026-08-10T14:00:00.000Z", updated_at: "2026-08-10T14:00:00.000Z" };
    const fetchMock = vi.fn(async () => jsonResponse(revoked));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderSettings();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Revoke Studio MacBook"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/settings/local-tool-tokens/token-1", { method: "DELETE" });
    expect(container.textContent).toContain("Revoked");
    await act(async () => root.unmount());

    const readOnlyHtml = renderToStaticMarkup(<LocalToolTokenSettings tokens={[initialToken]} onTokensChange={() => undefined} canMutate={false} />);
    expect(readOnlyHtml).toContain("Operations access is required");
    expect(readOnlyHtml).toMatch(/Create 30-day token<\/button>/);
    expect(readOnlyHtml).toContain("disabled=\"\"");
    expect(readOnlyHtml).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Revoke Studio MacBook"/);
  });
});

describe("SettingsShell local-tool token state", () => {
  it("keeps newly created safe metadata after leaving and returning to Codex tools", async () => {
    const created = { ...initialToken, id: "token-2", name: "Tour laptop", token_prefix: "lsmcp_token-2", last_used_at: null };
    const fetchMock = settingsFetchMock({ create: { token: "lsmcp_token-2_one-time-secret", record: created } });
    const { container, root } = await renderShell(fetchMock);

    await act(async () => setValue(container.querySelector('input[name="local-tool-token-name"]') as HTMLInputElement, "Tour laptop"));
    await act(async () => {
      buttonNamed(container, "Create 30-day token")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("lsmcp_token-2");

    await selectSettingsTab(container, "Profile");
    await selectSettingsTab(container, "Codex tools");

    expect(container.textContent).toContain("Tour laptop");
    expect(container.textContent).toContain("lsmcp_token-2");
    expect(container.textContent).not.toContain("lsmcp_token-2_one-time-secret");
    await act(async () => root.unmount());
  });

  it("keeps revoked safe metadata after leaving and returning to Codex tools", async () => {
    const revoked = { ...initialToken, revoked_at: "2026-08-10T14:00:00.000Z", updated_at: "2026-08-10T14:00:00.000Z" };
    const fetchMock = settingsFetchMock({ revoke: revoked });
    const { container, root } = await renderShell(fetchMock);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Revoke Studio MacBook"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Revoked");

    await selectSettingsTab(container, "Profile");
    await selectSettingsTab(container, "Codex tools");

    expect(container.textContent).toContain("Studio MacBook");
    expect(container.textContent).toContain("Revoked");
    expect(container.querySelector('button[aria-label="Revoke Studio MacBook"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it("keeps a deferred successful revoke after leaving Codex tools before the response", async () => {
    const response = deferred<Response>();
    const revoked = { ...initialToken, revoked_at: "2026-08-10T14:00:00.000Z", updated_at: "2026-08-10T14:00:00.000Z" };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("/api/settings/workspace?")) return jsonResponse({});
      if (url === "/api/settings/local-tool-tokens/token-1" && init?.method === "DELETE") return response.promise;
      throw new Error(`Unexpected fetch ${url}`);
    });
    const { container, root } = await renderShell(fetchMock);

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Revoke Studio MacBook"]')?.click());
    expect(fetchMock).toHaveBeenCalledWith("/api/settings/local-tool-tokens/token-1", { method: "DELETE" });
    await selectSettingsTab(container, "Profile");

    response.resolve(jsonResponse(revoked));
    await act(async () => { await response.promise; await Promise.resolve(); await Promise.resolve(); });
    await selectSettingsTab(container, "Codex tools");

    expect(container.textContent).toContain("Studio MacBook");
    expect(container.textContent).toContain("Revoked");
    expect(container.querySelector('button[aria-label="Revoke Studio MacBook"]')).toBeNull();
    await act(async () => root.unmount());
  });
});

async function renderSettings(onTokenChange?: (tokens: LocalToolTokenClientRecord[]) => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<TokenSettingsHarness onTokenChange={onTokenChange} />));
  return { container, root };
}

function TokenSettingsHarness({ onTokenChange }: { onTokenChange?: (tokens: LocalToolTokenClientRecord[]) => void }) {
  const [tokens, setTokens] = useState<LocalToolTokenClientRecord[]>([initialToken]);
  const updateTokens: Dispatch<SetStateAction<LocalToolTokenClientRecord[]>> = (action) => {
    setTokens((current) => {
      const next = typeof action === "function" ? action(current) : action;
      onTokenChange?.(next);
      return next;
    });
  };
  return <LocalToolTokenSettings tokens={tokens} onTokensChange={updateTokens} canMutate />;
}

async function renderShell(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const capabilities = {
    "operations.mutate": true,
    "workspace.manage_settings": false,
  } as ClientCapabilityMap;
  await act(async () => root.render(
    <SettingsShell
      user={{ id: "operator-1", name: "Operator", email: "operator@example.com" }}
      org={{ id: "org-1", name: "Label", slug: "label", plan: "internal" }}
      role="operator"
      capabilities={capabilities}
      initialMembers={[]}
      initialInvitations={[]}
      initialLocalToolTokens={[initialToken]}
      initialSection="codex-tools"
    />,
  ));
  return { container, root };
}

function settingsFetchMock(responses: { create?: unknown; revoke?: unknown }) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("/api/settings/workspace?")) return jsonResponse({});
    if (url === "/api/settings/local-tool-tokens" && init?.method === "POST" && responses.create) return jsonResponse(responses.create, 201);
    if (url === "/api/settings/local-tool-tokens/token-1" && init?.method === "DELETE" && responses.revoke) return jsonResponse(responses.revoke);
    throw new Error(`Unexpected fetch ${url}`);
  });
}

async function selectSettingsTab(container: HTMLElement, label: string) {
  const tab = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[role="tab"]')).find((candidate) => candidate.textContent?.trim() === label);
  await act(async () => tab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

function buttonNamed(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === name);
}

function setValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
