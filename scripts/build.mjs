import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const executableName = process.platform === "win32" ? "bb.exe" : "bb";
const candidates = [
  process.env.BB_BIN,
  join(homedir(), ".bb", "bin", executableName),
  executableName,
].filter(Boolean);

let lastError = null;
for (const candidate of candidates) {
  if (candidate !== executableName && !existsSync(candidate)) continue;
  const result = spawnSync(candidate, ["plugin", "build", "."], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.error?.code === "ENOENT") {
    lastError = result.error;
    continue;
  }
  process.exit(result.status ?? 1);
}

console.error("BB CLI was not found. Install BB or set BB_BIN to the CLI executable.");
if (lastError) console.error(lastError.message);
process.exit(1);
