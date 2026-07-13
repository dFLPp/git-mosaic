import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readContributionSnapshot,
  writeContributionSnapshot,
} from "./snapshot.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe("GitHub snapshots", () => {
  it("round-trips a versioned offline snapshot", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "git-mosaic-github-"));
    directories.push(directory);
    const snapshot = {
      schemaVersion: 1 as const,
      username: "octocat",
      period: { from: "2026-01-01", to: "2026-01-02" },
      fetchedAt: "2026-01-03T00:00:00.000Z",
      days: [
        {
          date: "2026-01-01",
          contributionCount: 1,
          contributionLevel: "FIRST_QUARTILE" as const,
          color: "#9be9a8",
        },
      ],
    };
    const file = path.join(directory, "nested", "snapshot.github.json");
    await writeContributionSnapshot(file, snapshot);
    expect(await readContributionSnapshot(file)).toEqual(snapshot);
  });
});
