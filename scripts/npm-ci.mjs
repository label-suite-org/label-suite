import { spawnSync } from "node:child_process";
import { constants } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function npmResultExitCode(result) {
  if (result.signal) return 128 + (constants.signals[result.signal] ?? 1);
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["ci", ...process.argv.slice(2)], {
    env: { ...process.env, SHARP_IGNORE_GLOBAL_LIBVIPS: "1" },
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  process.exitCode = npmResultExitCode(result);
}
