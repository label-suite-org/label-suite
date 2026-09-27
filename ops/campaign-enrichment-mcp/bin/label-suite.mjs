#!/usr/bin/env node
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const tsxApiUrl = pathToFileURL(require.resolve("tsx/esm/api"));
const tsconfigPath = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
const { register } = await import(tsxApiUrl);

register({ tsconfig: tsconfigPath });
await import(new URL("../src/index.ts", import.meta.url));
