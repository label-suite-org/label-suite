/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

function createDeferredResponse() {
  let resolve!: (value: Response) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Response>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve: (value: unknown) => {
      resolve(new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }));
    },
    reject: (error: unknown) => reject(error),
  };
}

describe("CommandPalette integration", () => {
  let container: HTMLDivElement;
  let root: Root;
  let reactActEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

  beforeEach(() => {
    vi.useFakeTimers();
    reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            records: [
              { id: "artist-1", kind: "artist", title: "Former Actress", href: "/artists/artist-1" },
              { id: "artist-1", kind: "artist", title: "Former Actress duplicate", href: "/artists/artist-1" },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(0), 0);
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => {
      window.clearTimeout(id);
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    window.localStorage.clear();
    delete reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function openPalette() {
    const assignMock = vi.fn();
    vi.stubGlobal("location", { pathname: "/", assign: assignMock });

    await act(async () => {
      root.render(<CommandPalette />);
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
      await vi.runOnlyPendingTimersAsync();
    });

    const input = container.querySelector('input[aria-label="Search commands"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    const inputElement = input as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    expect(valueSetter).toBeTypeOf("function");

    return { assignMock, inputElement, valueSetter };
  }

  async function setQuery(
    inputElement: HTMLInputElement,
    valueSetter: ((value: string) => void) | undefined,
    query: string,
  ) {
    if (!valueSetter) {
      throw new Error("Missing value setter on input element");
    }

    valueSetter.call(inputElement, query);
    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(151);
  }

  it("recomputes async record results and opens the selected record with Enter", async () => {
    const { assignMock, inputElement, valueSetter } = await openPalette();

    await act(async () => {
      await setQuery(inputElement, valueSetter, "former actress");
    });

    expect(fetch).toHaveBeenCalledWith("/api/search/records?q=former%20actress", {
      signal: expect.any(AbortSignal),
      headers: { Accept: "application/json" },
    });

    const matchingOptions = [...container.querySelectorAll('[role="option"]')].filter((option) =>
      option.textContent?.includes("Former Actress"),
    );
    expect(matchingOptions).toHaveLength(1);

    await act(async () => {
      inputElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(assignMock).toHaveBeenCalledWith("/artists/artist-1");
  });

  it("keeps the latest query result and ignores stale async arrivals when query changes", async () => {
    const firstRequest = createDeferredResponse();
    const secondRequest = createDeferredResponse();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("first")) return firstRequest.promise;
        return secondRequest.promise;
      }),
    );

    const { inputElement, valueSetter } = await openPalette();

    await act(async () => {
      await setQuery(inputElement, valueSetter, "first");
    });
    await act(async () => {
      await setQuery(inputElement, valueSetter, "current");
    });

    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondRequest.resolve({
        records: [
          { id: "artist-1", kind: "artist", title: "Current Query Match", href: "/artists/artist-1" },
          { id: "artist-1", kind: "artist", title: "Current Query Match Duplicate", href: "/artists/artist-1" },
        ],
      });
      await Promise.resolve();
    });

    const currentQueryOptions = [...container.querySelectorAll('[role="option"]')].filter((option) =>
      option.textContent?.includes("Current Query Match"),
    );
    expect(currentQueryOptions).toHaveLength(1);

    await act(async () => {
      firstRequest.resolve({ records: [{ id: "contact-1", kind: "contact", title: "Old Query Match", href: "/contacts" }] });
      await Promise.resolve();
    });

    const staleOptions = [...container.querySelectorAll('[role="option"]')].filter((option) =>
      option.textContent?.includes("Old Query Match"),
    );
    expect(staleOptions).toHaveLength(0);
  });

  it("does not keep old records actionable while a newer query is loading", async () => {
    const firstRequest = createDeferredResponse();
    const secondRequest = createDeferredResponse();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("former%20actress")) return firstRequest.promise;
        return secondRequest.promise;
      }),
    );

    const { assignMock, inputElement, valueSetter } = await openPalette();

    await act(async () => {
      await setQuery(inputElement, valueSetter, "former actress");
    });

    await act(async () => {
      firstRequest.resolve({
        records: [{ id: "artist-1", kind: "artist", title: "Former Actress", href: "/artists/artist-1" }],
      });
      await Promise.resolve();
    });

    const firstMatch = [...container.querySelectorAll('[role="option"]')].filter((option) =>
      option.textContent?.includes("Former Actress"),
    );
    expect(firstMatch).toHaveLength(1);

    await act(async () => {
      await setQuery(inputElement, valueSetter, "current singer");
    });

    const staleMatch = [...container.querySelectorAll('[role="option"]')].filter((option) =>
      option.textContent?.includes("Former Actress"),
    );
    expect(staleMatch).toHaveLength(0);

    await act(async () => {
      inputElement.dispatchEvent(new KeyboardEvent("Enter", { key: "Enter", bubbles: true }));
    });
    expect(assignMock).toHaveBeenCalledTimes(0);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Searching records.");

    await act(async () => {
      secondRequest.resolve({
        records: [{ id: "artist-2", kind: "artist", title: "Current Singer", href: "/artists/artist-2" }],
      });
      await Promise.resolve();
    });

    const secondMatch = [...container.querySelectorAll('[role="option"]')].filter((option) =>
      option.textContent?.includes("Current Singer"),
    );
    expect(secondMatch).toHaveLength(1);
  });

  it("keeps the palette loading state while an older request settles before the latest finishes", async () => {
    const firstRequest = createDeferredResponse();
    const secondRequest = createDeferredResponse();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("former%20actress")) return firstRequest.promise;
        return secondRequest.promise;
      }),
    );

    const { inputElement, valueSetter } = await openPalette();

    await act(async () => {
      await setQuery(inputElement, valueSetter, "former actress");
    });

    await act(async () => {
      await setQuery(inputElement, valueSetter, "current singer");
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe("Searching records.");
    expect(container.querySelector('[role="listbox"]')?.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      firstRequest.resolve({
        records: [{ id: "artist-1", kind: "artist", title: "Former Actress", href: "/artists/artist-1" }],
      });
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe("Searching records.");
    expect(container.querySelector('[role="listbox"]')?.getAttribute("aria-busy")).toBe("true");
    expect([...container.querySelectorAll('[role="option"]')].filter((option) =>
      option.textContent?.includes("Former Actress"),
    )).toHaveLength(0);

    await act(async () => {
      secondRequest.resolve({
        records: [{ id: "artist-2", kind: "artist", title: "Current Singer", href: "/artists/artist-2" }],
      });
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
    expect(container.querySelector('[role="listbox"]')?.getAttribute("aria-busy")).toBe("false");
    expect([...container.querySelectorAll('[role="option"]')].filter((option) =>
      option.textContent?.includes("Current Singer"),
    )).toHaveLength(1);
  });

  it("shows accessible loading and error states while searching", async () => {
    const pendingRequest = createDeferredResponse();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => pendingRequest.promise));

    const { inputElement, valueSetter } = await openPalette();

    await act(async () => {
      await setQuery(inputElement, valueSetter, "error");
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe("Searching records.");
    expect(container.querySelector('[role="listbox"]')?.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      pendingRequest.reject(new Error("network down"));
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe("Record search is temporarily unavailable.");
    expect(container.querySelector('[role="listbox"]')?.getAttribute("aria-busy")).toBe("false");
  });

  it("returns to an idle, non-busy state when the latest request aborts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new DOMException("aborted", "AbortError")));

    const { inputElement, valueSetter } = await openPalette();

    await act(async () => {
      await setQuery(inputElement, valueSetter, "abort");
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
    expect(container.querySelector('[role="listbox"]')?.getAttribute("aria-busy")).toBe("false");
    expect(container.querySelector('[role="status"]')?.textContent).not.toContain("temporarily unavailable");
  });

  it("renders empty state text when a query returns no results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ records: [] }), { headers: { "content-type": "application/json" } })),
    );

    const { inputElement, valueSetter } = await openPalette();

    await act(async () => {
      await setQuery(inputElement, valueSetter, "zzz");
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe("No record results found.");
    expect(container.querySelector('[role="listbox"]')?.textContent).toContain("No results found");
  });
});
