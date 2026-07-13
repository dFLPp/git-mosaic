import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject } from "./project.js";
import {
  createCommitPlan,
  readCommitPlan,
  verifyCommitPlan,
  writeCommitPlan,
} from "./planner.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

function plannedProject() {
  const project = createProject({
    name: "plan-test",
    period: { from: "2026-01-04", to: "2026-01-10" },
    timezone: "America/Los_Angeles",
    now: "2026-01-01T00:00:00.000Z",
  });
  project.intensityMap[0]![0] = 1;
  project.intensityMap[1]![0] = 2;
  return project;
}

describe("commit planning", () => {
  it("is deterministic apart from generatedAt and resolves timestamps", () => {
    const input = {
      project: plannedProject(),
      repository: {
        path: "/tmp/repository",
        branch: "main",
        mode: "new" as const,
      },
      author: { name: "Example", email: "example@example.com" },
      allowFuture: true,
    };
    const first = createCommitPlan({
      ...input,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const second = createCommitPlan({
      ...input,
      generatedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(first.checksum).toBe(second.checksum);
    expect(first.planId).toBe(second.planId);
    expect(first.totals).toEqual({
      days: 2,
      commits: 5,
      maximumCommitsPerDay: 4,
    });
    expect(first.days[0]?.commits[0]?.timestamp).toBe(
      "2026-01-04T12:00:00-08:00",
    );
    expect(first.days[1]?.commits[3]?.message).toBe(
      "git-mosaic: pixel 2026-01-05 (4/4)",
    );
  });

  it("detects content changes and enforces limits", () => {
    const plan = createCommitPlan({
      project: plannedProject(),
      repository: { path: "/tmp/repository", branch: "main", mode: "new" },
      author: { name: "Example", email: "example@example.com" },
      allowFuture: true,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(() =>
      verifyCommitPlan({ ...plan, projectName: "tampered" }),
    ).toThrow(/GM013|checksum/);
    expect(() =>
      createCommitPlan({
        project: plannedProject(),
        repository: { path: "/tmp/repository", branch: "main", mode: "new" },
        author: { name: "Example", email: "example@example.com" },
        maximumTotalCommits: 4,
        allowFuture: true,
      }),
    ).toThrow(/GM009|contains 5 commits/);
  });

  it("writes and reads a verified plan atomically", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "git-mosaic-plan-"));
    directories.push(directory);
    const plan = createCommitPlan({
      project: plannedProject(),
      repository: {
        path: path.join(directory, "repository"),
        branch: "main",
        mode: "new",
      },
      author: { name: "Example", email: "example@example.com" },
      allowFuture: true,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const planPath = path.join(directory, "plans", "plan.json");
    await writeCommitPlan(planPath, plan);
    expect(await readCommitPlan(planPath)).toEqual(plan);
  });
});
