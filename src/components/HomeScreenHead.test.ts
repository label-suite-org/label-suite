import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("iPhone Home Screen web-app metadata", () => {
  it("declares a same-origin standalone app using existing icons", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest"));
    expect(manifest.display).toBe("standalone");
    expect(manifest.id).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest).not.toHaveProperty("orientation");
    for (const icon of manifest.icons) {
      expect(icon.src).toMatch(/^\/(?!\/)/);
      expect(existsSync(resolve(root, "public", icon.src.slice(1)))).toBe(true);
    }
  });

  it("links the manifest and keeps Safari compatibility metadata centralized", () => {
    const head = read("src/components/HomeScreenHead.astro");
    expect(head).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(head).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(head).toContain('name="apple-mobile-web-app-status-bar-style" content="default"');
    expect(head).not.toContain("user-scalable=no");
    expect(head).not.toContain("serviceWorker");
  });

  for (const layout of ["Layout", "AppLayout", "AuthLayout"]) {
    it(`includes metadata in ${layout} while retaining accessible viewport zoom`, () => {
      const text = read(`src/layouts/${layout}.astro`);
      expect(text).toContain('<HomeScreenHead />');
      expect(text).toContain('content="width=device-width, initial-scale=1"');
      expect(text).not.toContain("user-scalable=no");
    });
  }
});
