import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { build, type Plugin } from "vite";
import { describe, expect, it } from "vitest";

const browserPeerImports = ["react", "react-dom", "react/jsx-runtime"];

function rejectNodeBuiltins(): Plugin {
  return {
    name: "reject-node-builtins-in-campaign-editor",
    enforce: "pre",
    resolveId(source) {
      if (source.startsWith("node:") || builtinModules.includes(source)) {
        this.error(`Campaign editor browser bundle cannot import Node built-in ${source}`);
      }
      return null;
    },
  };
}

describe("CampaignRichTextEditor client bundle", () => {
  it("produces browser ES entries for the editor and canonical document module without Node built-ins", async () => {
    const editorEntry = resolve("src/components/campaigns/CampaignRichTextEditor.tsx");
    const richTextEntry = resolve("src/lib/campaign-rich-text.ts");
    const result = await build({
      configFile: false,
      logLevel: "silent",
      plugins: [rejectNodeBuiltins()],
      build: {
        write: false,
        lib: {
          entry: { editor: editorEntry, campaignRichText: richTextEntry },
          formats: ["es"],
        },
        rollupOptions: { external: browserPeerImports },
      },
    });
    if (!Array.isArray(result) && !("output" in result)) {
      throw new Error("Campaign editor bundle unexpectedly returned a Vite watcher");
    }
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(({ output }) => output);
    const chunks = outputs.filter((output) => output.type === "chunk");
    const emittedFiles = new Set(outputs.map((output) => output.fileName));
    const externalImports = [...new Set(chunks.flatMap((chunk) => chunk.imports.filter((specifier) => !emittedFiles.has(specifier))))].sort();

    expect(chunks.map((chunk) => chunk.facadeModuleId)).toEqual(expect.arrayContaining([editorEntry, richTextEntry]));
    expect(externalImports).toEqual(browserPeerImports.slice().sort());
  });
});
