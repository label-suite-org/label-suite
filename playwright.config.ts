import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? process.env.PUBLIC_SITE_URL ?? "http://127.0.0.1:4321";

export default defineConfig({
  testDir: "tests/release-gate",
  fullyParallel: false,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  captureGitInfo: { commit: true, diff: false },
  reporter: [["list"], ["json", { outputFile: "test-results/release-gate-summary.json" }]],
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-gate",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile-390-gate",
      use: {
        ...devices["iPhone 13"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "mobile-320-gate",
      use: {
        ...devices["iPhone 13"],
        viewport: { width: 320, height: 712 },
      },
    },
  ],
});
