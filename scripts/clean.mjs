import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "..");
const workspaceGroups = ["apps", "packages"];

const packageDirectories = (
  await Promise.all(
    workspaceGroups.map(async (group) => {
      const groupDirectory = resolve(workspaceRoot, group);
      const entries = await readdir(groupDirectory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => resolve(groupDirectory, entry.name));
    }),
  )
).flat();

await Promise.all(
  packageDirectories.flatMap((packageDirectory) =>
    [
      "dist",
      "dist-server",
      "coverage",
      "tsconfig.tsbuildinfo",
      "tsconfig.server.tsbuildinfo",
    ].map((entry) =>
      rm(resolve(packageDirectory, entry), { force: true, recursive: true }),
    ),
  ),
);

await Promise.all(
  ["artifacts", "coverage"].map((entry) =>
    rm(resolve(workspaceRoot, entry), { force: true, recursive: true }),
  ),
);
