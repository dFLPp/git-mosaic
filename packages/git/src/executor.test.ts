import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCommitPlan, createProject } from "@git-mosaic/core";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import { applyCommitPlan, validateCommitPlanExecution } from "./executor.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "git-mosaic-git-"));
  directories.push(directory);
  return directory;
}

function planFor(
  repositoryPath: string,
  options: {
    intensity?: 1 | 2 | 3 | 4;
    commitMode?: "empty" | "file";
    filePath?: string;
    repositoryMode?: "new" | "existing";
    expectedHead?: string;
    files?: { path: string; content: string }[];
  } = {},
) {
  const project = createProject({
    name: "git-test",
    period: { from: "2026-01-04", to: "2026-01-10" },
    timezone: "America/Los_Angeles",
    now: "2026-01-01T00:00:00.000Z",
  });
  project.intensityMap[0]![0] = options.intensity ?? 2;
  return createCommitPlan({
    project,
    repository: {
      path: repositoryPath,
      branch: "main",
      mode: options.repositoryMode ?? "new",
      ...(options.expectedHead === undefined
        ? {}
        : { expectedHead: options.expectedHead }),
    },
    author: { name: "Mosaic Author", email: "mosaic@example.com" },
    committer: { name: "Mosaic Committer", email: "committer@example.com" },
    commitMode: options.commitMode ?? "empty",
    ...(options.filePath === undefined ? {} : { filePath: options.filePath }),
    ...(options.files === undefined ? {} : { files: options.files }),
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("new repository materialization", () => {
  it("keeps dry-run read-only and requires confirmation", async () => {
    const root = await temporaryDirectory();
    const repository = path.join(root, "repository");
    const plan = planFor(repository);
    const dryRun = await applyCommitPlan(plan, { dryRun: true });
    expect(dryRun).toMatchObject({ status: "dry-run", createdCommits: 0 });
    await expect(
      readFile(path.join(repository, ".git", "HEAD")),
    ).rejects.toThrow();
    await expect(applyCommitPlan(plan)).rejects.toThrow(
      /explicit confirmation/,
    );
    await expect(
      applyCommitPlan({ ...plan, projectName: "tampered" }, { dryRun: true }),
    ).rejects.toThrow(/GM013|checksum/);
  });

  it("creates commits with exact identities, dates, order, and trailers", async () => {
    const root = await temporaryDirectory();
    const repository = path.join(root, "repository");
    const plan = planFor(repository);
    const result = await applyCommitPlan(plan, { confirmed: true });
    expect(result).toMatchObject({
      status: "complete",
      createdCommits: 4,
      appliedSteps: 4,
    });

    const log = await execa(
      "git",
      ["log", "--reverse", "--format=%an|%ae|%cn|%ce|%aI|%cI|%B%x00"],
      { cwd: repository },
    );
    const commits = log.stdout
      .split("\0")
      .map((entry) => entry.trim())
      .filter(Boolean);
    expect(commits).toHaveLength(4);
    expect(commits[0]).toContain(
      "Mosaic Author|mosaic@example.com|Mosaic Committer|committer@example.com|2026-01-04T12:00:00-08:00|2026-01-04T12:00:00-08:00",
    );
    expect(commits[3]).toContain(`Git-Mosaic-Step: 4/4`);
    await expect(applyCommitPlan(plan, { confirmed: true })).rejects.toThrow(
      /already fully applied/,
    );
  });

  it("resumes an interrupted prefix without duplicates", async () => {
    const root = await temporaryDirectory();
    const repository = path.join(root, "repository");
    const plan = planFor(repository);
    const controller = new AbortController();
    const partial = await applyCommitPlan(plan, {
      confirmed: true,
      signal: controller.signal,
      onProgress: ({ step }) => {
        if (step === 2) controller.abort();
      },
    });
    expect(partial).toMatchObject({
      status: "partial",
      createdCommits: 2,
      appliedSteps: 2,
    });

    const complete = await applyCommitPlan(plan, { confirmed: true });
    expect(complete).toMatchObject({
      status: "complete",
      createdCommits: 2,
      appliedSteps: 4,
    });
    expect(
      (await execa("git", ["rev-list", "--count", "HEAD"], { cwd: repository }))
        .stdout,
    ).toBe("4");
  });

  it("supports deterministic file commits", async () => {
    const root = await temporaryDirectory();
    const repository = path.join(root, "repository");
    const plan = planFor(repository, {
      intensity: 1,
      commitMode: "file",
      filePath: ".git-mosaic/activity.log",
    });
    await applyCommitPlan(plan, { confirmed: true });
    expect(
      await readFile(
        path.join(repository, ".git-mosaic", "activity.log"),
        "utf8",
      ),
    ).toContain(`${plan.planId}\t1/1`);
    expect(
      (await execa("git", ["status", "--porcelain"], { cwd: repository }))
        .stdout,
    ).toBe("");
  });

  it("completes an empty plan without creating commits", async () => {
    const root = await temporaryDirectory();
    const repository = path.join(root, "empty-repository");
    const project = createProject({
      name: "empty",
      period: { from: "2026-01-04", to: "2026-01-10" },
      timezone: "UTC",
      now: "2026-01-01T00:00:00.000Z",
    });
    const plan = createCommitPlan({
      project,
      repository: { path: repository, branch: "main", mode: "new" },
      author: { name: "Empty", email: "empty@example.com" },
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await applyCommitPlan(plan, { confirmed: true })).toMatchObject({
      status: "complete",
      totalSteps: 0,
      createdCommits: 0,
    });
    expect(
      await readFile(path.join(repository, ".git", "HEAD"), "utf8"),
    ).toContain("refs/heads/main");
  });
});

describe("existing repository safeguards", () => {
  it("requires explicit authorization, expected HEAD, clean state, branch, and remote approval", async () => {
    const root = await temporaryDirectory();
    const repository = path.join(root, "existing");
    await execa("git", ["init", "-b", "main", repository]);
    await execa("git", ["commit", "--allow-empty", "-m", "base"], {
      cwd: repository,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Base",
        GIT_AUTHOR_EMAIL: "base@example.com",
        GIT_COMMITTER_NAME: "Base",
        GIT_COMMITTER_EMAIL: "base@example.com",
      },
    });
    const head = (
      await execa("git", ["rev-parse", "HEAD"], { cwd: repository })
    ).stdout;
    const plan = planFor(repository, {
      repositoryMode: "existing",
      expectedHead: head,
    });
    await expect(validateCommitPlanExecution(plan)).rejects.toThrow(
      /explicit authorization/,
    );

    await writeFile(path.join(repository, "dirty.txt"), "dirty");
    await expect(
      validateCommitPlanExecution(plan, { allowExistingRepository: true }),
    ).rejects.toThrow(/GM006|uncommitted/);
    await rm(path.join(repository, "dirty.txt"));

    await execa(
      "git",
      ["remote", "add", "origin", "https://example.invalid/repository.git"],
      {
        cwd: repository,
      },
    );
    await expect(
      validateCommitPlanExecution(plan, { allowExistingRepository: true }),
    ).rejects.toThrow(/configured remotes/);
    const report = await validateCommitPlanExecution(plan, {
      allowExistingRepository: true,
      allowRepositoryWithRemotes: true,
    });
    expect(report).toMatchObject({
      branch: "main",
      hasRemotes: true,
      applicationState: "not_started",
    });
  });

  it.skipIf(process.platform === "win32")(
    "rejects file-mode symlink escapes and Git-internal paths",
    async () => {
      const root = await temporaryDirectory();
      const repository = path.join(root, "existing-file");
      const outside = path.join(root, "outside");
      await execa("git", ["init", "-b", "main", repository]);
      await execa("git", ["commit", "--allow-empty", "-m", "base"], {
        cwd: repository,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Base",
          GIT_AUTHOR_EMAIL: "base@example.com",
          GIT_COMMITTER_NAME: "Base",
          GIT_COMMITTER_EMAIL: "base@example.com",
        },
      });
      await mkdir(outside);
      await symlink(outside, path.join(repository, "linked"), "dir");
      await execa("git", ["add", "linked"], { cwd: repository });
      await execa("git", ["commit", "-m", "tracked symlink fixture"], {
        cwd: repository,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Base",
          GIT_AUTHOR_EMAIL: "base@example.com",
          GIT_COMMITTER_NAME: "Base",
          GIT_COMMITTER_EMAIL: "base@example.com",
        },
      });
      const head = (
        await execa("git", ["rev-parse", "HEAD"], { cwd: repository })
      ).stdout;
      const symlinkPlan = planFor(repository, {
        intensity: 1,
        commitMode: "file",
        filePath: "linked/activity.log",
        repositoryMode: "existing",
        expectedHead: head,
      });
      await expect(
        applyCommitPlan(symlinkPlan, {
          confirmed: true,
          allowExistingRepository: true,
        }),
      ).rejects.toThrow(/symlink/);

      const gitInternalPlan = planFor(repository, {
        intensity: 1,
        commitMode: "file",
        filePath: ".git/config",
        repositoryMode: "existing",
        expectedHead: head,
      });
      await expect(
        applyCommitPlan(gitInternalPlan, {
          confirmed: true,
          allowExistingRepository: true,
        }),
      ).rejects.toThrow(/Unsafe commit file path/);
    },
  );
});

describe("repository files", () => {
  it("commits a README in the first commit without adding a commit", async () => {
    const root = await temporaryDirectory();
    const repository = path.join(root, "art");
    const plan = planFor(repository, {
      intensity: 2,
      files: [{ path: "README.md", content: "# generated art\n" }],
    });

    const result = await applyCommitPlan(plan, { confirmed: true });

    // The file rides along: the commit count still matches the plan exactly.
    expect(result.createdCommits).toBe(plan.totals.commits);
    expect(await readFile(path.join(repository, "README.md"), "utf8")).toBe(
      "# generated art\n",
    );

    // It is committed, not merely left in the worktree.
    const status = await execa("git", ["status", "--porcelain"], {
      cwd: repository,
    });
    expect(status.stdout.trim()).toBe("");

    // And it belongs to the very first commit of the plan (the root commit;
    // `log --reverse --max-count=1` would apply the limit before reversing).
    const firstCommit = await execa(
      "git",
      ["rev-list", "--max-parents=0", "HEAD"],
      { cwd: repository },
    );
    const files = await execa(
      "git",
      ["show", "--name-only", "--format=", firstCommit.stdout.trim()],
      { cwd: repository },
    );
    expect(files.stdout.trim()).toBe("README.md");
  });

  it("never overwrites a file that already exists in the repository", async () => {
    const root = await temporaryDirectory();
    const repository = path.join(root, "existing");
    await mkdir(repository, { recursive: true });
    await execa("git", ["init", "--initial-branch", "main"], {
      cwd: repository,
    });
    await execa("git", ["config", "user.name", "Real Person"], {
      cwd: repository,
    });
    await execa("git", ["config", "user.email", "real@example.com"], {
      cwd: repository,
    });
    await writeFile(path.join(repository, "README.md"), "# my real project\n");
    await execa("git", ["add", "."], { cwd: repository });
    await execa("git", ["commit", "-m", "real work"], { cwd: repository });
    const head = await execa("git", ["rev-parse", "HEAD"], { cwd: repository });

    const plan = planFor(repository, {
      repositoryMode: "existing",
      expectedHead: head.stdout.trim(),
      files: [{ path: "README.md", content: "# artwork\n" }],
    });
    const result = await applyCommitPlan(plan, {
      confirmed: true,
      allowExistingRepository: true,
    });

    expect(await readFile(path.join(repository, "README.md"), "utf8")).toBe(
      "# my real project\n",
    );
    expect(result.warnings.join(" ")).toContain("left untouched");
  });
});
