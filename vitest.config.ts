import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig, type ViteUserConfig } from "vitest/config";

export default defineConfig(async (): Promise<ViteUserConfig> => ({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    ...(process.env.STORYBOOK_CONFIG_DIR || process.env.LABEL_SUITE_STORYBOOK_TEST ? {
      projects: [{
        plugins: await (await import("@storybook/addon-vitest/vitest-plugin")).storybookTest({ configDir: fileURLToPath(new URL("./.storybook", import.meta.url)) }),
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: (await import("@vitest/browser-playwright")).playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      }],
    } : {}),
    exclude: [
      ...configDefaults.exclude,
      ".worktrees/**",
      "**/.worktrees/**",
      ".claude/**",
      "**/.claude/**",
      "tests/release-gate/**",
    ],
  },
}));
