import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GitHubContributionProvider } from "@git-mosaic/github";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importGitHubContributions } from "./github.js";
import { initializeProject, readProject, writeProject } from "./project.js";
import { buildPreviewCalendar } from "./preview.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe("GitHub project integration", () => {
  it("persists observations for offline mixed previews", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "git-mosaic-github-core-"),
    );
    directories.push(directory);
    const project = await initializeProject(directory, {
      name: "github",
      period: { from: "2026-01-04", to: "2026-01-10" },
      timezone: "UTC",
      now: "2026-01-01T00:00:00.000Z",
    });
    project.intensityMap[0]![0] = 1;
    await writeProject(directory, project);
    const provider: GitHubContributionProvider = {
      fetchCalendar: vi.fn(async () => ({
        schemaVersion: 1 as const,
        username: "octocat",
        period: project.period,
        fetchedAt: "2026-01-02T00:00:00.000Z",
        days: [
          {
            date: "2026-01-04",
            contributionCount: 3,
            contributionLevel: "SECOND_QUARTILE" as const,
            color: "#40c463",
          },
        ],
      })),
    };
    const updated = await importGitHubContributions(
      directory,
      "octocat",
      provider,
      "2026-01-02T00:00:00.000Z",
    );
    const preview = buildPreviewCalendar(updated);
    expect(preview.cells[0]?.[0]).toMatchObject({
      existingCount: 3,
      plannedCount: 1,
      finalCount: 4,
      confidence: "MIXED",
    });
    expect(
      JSON.parse(
        await readFile(path.join(directory, "snapshot.github.json"), "utf8"),
      ),
    ).toEqual(updated.existingContributions);
    expect((await readProject(directory)).existingContributions).toEqual(
      updated.existingContributions,
    );
  });
});
