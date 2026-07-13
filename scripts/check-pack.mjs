import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = resolve(import.meta.dirname, "..");
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
    "--dry-run",
    "--json",
  ],
  { cwd: workspaceRoot, encoding: "utf8" },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

const packages = JSON.parse(result.stdout);
const failures = [];

for (const packageResult of packages) {
  const paths = packageResult.files.map((file) => file.path);
  const manifestPath =
    packageResult.name === "git-mosaic"
      ? "apps/cli/package.json"
      : `packages/${packageResult.name.replace("@git-mosaic/", "")}/package.json`;
  const manifest = JSON.parse(
    await readFile(resolve(workspaceRoot, manifestPath), "utf8"),
  );

  for (const required of [
    "LICENSE",
    "package.json",
    "dist/index.js",
    "dist/index.d.ts",
  ]) {
    if (!paths.includes(required)) {
      failures.push(`${packageResult.name}: missing ${required}`);
    }
  }

  for (const path of paths) {
    if (
      path.startsWith("src/") ||
      path.includes(".test.") ||
      path.includes(".spec.") ||
      path.startsWith("tsconfig")
    ) {
      failures.push(`${packageResult.name}: unexpected packed file ${path}`);
    }
  }

  if (manifest.license !== "MIT")
    failures.push(`${packageResult.name}: license must be MIT`);
  if (manifest.engines?.node !== ">=22")
    failures.push(`${packageResult.name}: engines.node must be >=22`);
  if (!manifest.files?.includes("dist"))
    failures.push(`${packageResult.name}: files must include dist`);
  if (manifest.publishConfig?.access !== "public")
    failures.push(`${packageResult.name}: publish access must be public`);
  if (manifest.publishConfig?.provenance !== true)
    failures.push(`${packageResult.name}: provenance must be enabled`);
}

const cli = JSON.parse(
  await readFile(resolve(workspaceRoot, "apps/cli/package.json"), "utf8"),
);
if (cli.bin?.["git-mosaic"] !== "./dist/index.js") {
  failures.push("git-mosaic: bin must point to ./dist/index.js");
}

if (failures.length > 0) {
  process.stderr.write(
    `Package validation failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(`Validated ${packages.length} publishable packages.\n`);
