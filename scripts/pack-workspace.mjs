import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = resolve(import.meta.dirname, "..");
const destination = resolve(workspaceRoot, process.argv[2] ?? "artifacts");

await rm(destination, { force: true, recursive: true });
await mkdir(destination, { recursive: true });

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(
  pnpm,
  [
    "-r",
    "--filter",
    "git-mosaic",
    "--filter",
    "./packages/*",
    "pack",
    "--pack-destination",
    destination,
  ],
  { cwd: workspaceRoot, stdio: "inherit" },
);

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
