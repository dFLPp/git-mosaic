import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "..");
const manifestPaths = [
  "apps/cli/package.json",
  "packages/calendar/package.json",
  "packages/core/package.json",
  "packages/git/package.json",
  "packages/github/package.json",
  "packages/renderer/package.json",
  "packages/schemas/package.json",
];

const manifests = await Promise.all(
  manifestPaths.map(async (path) =>
    JSON.parse(await readFile(resolve(workspaceRoot, path), "utf8")),
  ),
);
const versions = new Set(manifests.map((manifest) => manifest.version));

if (process.env.RELEASE_REF_TYPE !== "tag") {
  throw new Error("npm publication is only allowed from a Git tag");
}
if (versions.size !== 1) {
  throw new Error(
    "all publishable workspace packages must have the same version",
  );
}

const [version] = versions;
if (process.env.RELEASE_TAG !== `v${version}`) {
  throw new Error(`release tag must be v${version}`);
}
if (!process.env.NPM_TOKEN) {
  throw new Error(
    "NPM_TOKEN is required when publication is explicitly enabled",
  );
}
if (!/^[a-z][a-z0-9._-]*$/u.test(process.env.NPM_DIST_TAG ?? "")) {
  throw new Error("npm distribution tag is invalid");
}

process.stdout.write(`Release authorization validated for v${version}.\n`);
