import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const packageDirectory = resolve(process.cwd());

await Promise.all(
  ["dist", "coverage", "tsconfig.tsbuildinfo"].map((entry) =>
    rm(resolve(packageDirectory, entry), { force: true, recursive: true }),
  ),
);
