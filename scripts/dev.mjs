import { rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const devCachePath = join(process.cwd(), ".next", "dev");

try {
  rmSync(devCachePath, { recursive: true, force: true });
} catch (error) {
  console.warn(`Failed to clear ${devCachePath}:`, error);
}

const child = spawn("next", ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
