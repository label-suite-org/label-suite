import { DEFAULT_BASE_URL, runCli } from "./cli";
import { CampaignEnrichmentClient, normalizeBaseUrl, type CampaignEnrichmentClientOptions } from "./client";
import { MacOsKeychainCredentialStore } from "./keychain";
import { serveCampaignEnrichmentMcp } from "./mcp";

const TEST_DEPENDENCIES_SYMBOL = Symbol.for(
  "label-suite.campaign-enrichment-mcp.test-dependencies",
);

type TestDependencies = {
  createClient: (options: CampaignEnrichmentClientOptions) => CampaignEnrichmentClient;
};

function createClient(options: CampaignEnrichmentClientOptions): CampaignEnrichmentClient {
  // Explicit child-process test seam; production always falls through to the Keychain client.
  if (process.env.NODE_ENV !== "test" || process.env.VITEST !== "true") {
    return new CampaignEnrichmentClient(options);
  }
  const dependencies = (globalThis as { [TEST_DEPENDENCIES_SYMBOL]?: TestDependencies })[
    TEST_DEPENDENCIES_SYMBOL
  ];
  return dependencies?.createClient(options) ?? new CampaignEnrichmentClient(options);
}

const args = process.argv.slice(2);
const mcpBaseUrl = mcpServeBaseUrl(args);

if (mcpBaseUrl !== null) {
  const client = createClient({
    baseUrl: mcpBaseUrl,
    credentials: new MacOsKeychainCredentialStore(),
  });
  console.error("Label Suite operator MCP server ready on stdio.");
  serveCampaignEnrichmentMcp(client);
  process.exitCode = 0;
} else {
  process.exitCode = await runCli(args);
}

function mcpServeBaseUrl(command: readonly string[]): string | null {
  if (command.length === 2 && command[0] === "mcp" && command[1] === "serve") {
    return DEFAULT_BASE_URL;
  }
  if (
    command.length !== 4
    || command[0] !== "mcp"
    || command[1] !== "serve"
    || command[2] !== "--base-url"
  ) {
    return null;
  }
  try {
    const baseUrl = normalizeBaseUrl(command[3] ?? "");
    return baseUrl.startsWith("https://") ? baseUrl : null;
  } catch {
    return null;
  }
}
