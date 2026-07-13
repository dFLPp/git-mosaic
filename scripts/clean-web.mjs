import { rm } from "node:fs/promises";
import { resolve } from "node:path";

await Promise.all(
  [
    "dist",
    "dist-server",
    "tsconfig.tsbuildinfo",
    "tsconfig.server.tsbuildinfo",
  ].map((entry) =>
    rm(resolve(process.cwd(), entry), { force: true, recursive: true }),
  ),
);
