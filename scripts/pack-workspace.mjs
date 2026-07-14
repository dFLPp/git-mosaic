import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = resolve(import.meta.dirname, "..");
const destination = resolve(workspaceRoot, process.argv[2] ?? "artifacts");

await rm(destination, { force: true, recursive: true });
await mkdir(destination, { recursive: true });

const onWindows = process.platform === "win32";
const pnpm = onWindows ? "pnpm.cmd" : "pnpm";
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
    // Under a shell the arguments are re-parsed, so a path containing spaces
    // has to be quoted.
    onWindows ? `"${destination}"` : destination,
  ],
  // Node refuses to spawn a .cmd shim without a shell (CVE-2024-27980), so on
  // Windows this fails with EINVAL otherwise.
  { cwd: workspaceRoot, stdio: "inherit", shell: onWindows },
);

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
