/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import IntegrationsWorkspace from "./IntegrationsWorkspace";

it("disables refresh while pending and clears an earlier failure after retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finish!: (response: Response) => void;
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Temporarily unavailable" }), { status: 503 }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const data = { providers: [], connections: [], syncJobs: [], errors: [] };
  try {
    await act(async () => root.render(<IntegrationsWorkspace initialData={data} />));
    const refresh = host.querySelector("button")!;
    await act(async () => refresh.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Temporarily unavailable");
    await act(async () => refresh.click());
    expect(refresh.disabled).toBe(true);
    await act(async () => finish(new Response(JSON.stringify(data))));
    expect(refresh.disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
