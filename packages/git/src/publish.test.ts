import { execa } from "execa";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isGitMosaicError } from "@git-mosaic/schemas";
import { publishRepository } from "./publish.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporary(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

async function git(arguments_: string[], cwd: string) {
  return execa("git", arguments_, { cwd, stdin: "ignore" });
}

/** A repository with one commit on `main`, like `apply` leaves behind. */
async function repositoryWithHistory(): Promise<string> {
  const directory = await temporary("git-mosaic-publish-");
  await git(["init", "--initial-branch", "main"], directory);
  await git(["config", "user.name", "Example User"], directory);
  await git(["config", "user.email", "user@example.com"], directory);
  await git(["commit", "--allow-empty", "-m", "mosaic"], directory);
  return directory;
}

/** A bare repository standing in for GitHub. */
async function bareRemote(): Promise<string> {
  const directory = await temporary("git-mosaic-remote-");
  await git(["init", "--bare", "--initial-branch", "main"], directory);
  return directory;
}

async function commitCount(repository: string, reference: string) {
  const result = await execa("git", ["rev-list", "--count", reference], {
    cwd: repository,
    stdin: "ignore",
  });
  return Number(result.stdout.trim());
}

describe("publishRepository", () => {
  it("reports what it would push without touching the remote", async () => {
    const repository = await repositoryWithHistory();
    const remote = await bareRemote();

    const report = await publishRepository({
      repositoryPath: repository,
      branch: "main",
      remoteUrl: remote,
    });

    expect(report.status).toBe("dry-run");
    expect(report.commitsToPush).toBe(1);
    expect(report.willCreateRepository).toBe(false);
    expect(report.warnings.join(" ")).toContain("contribution artwork");
    // Nothing was pushed and no remote was wired up.
    expect(await commitCount(remote, "--all")).toBe(0);
    const remotes = await execa("git", ["remote"], { cwd: repository });
    expect(remotes.stdout.trim()).toBe("");
  });

  it("attaches the remote and pushes only when confirmed", async () => {
    const repository = await repositoryWithHistory();
    const remote = await bareRemote();

    const report = await publishRepository({
      repositoryPath: repository,
      branch: "main",
      remoteUrl: remote,
      confirmed: true,
    });

    expect(report.status).toBe("published");
    expect(report.remoteUrl).toBe(remote);
    expect(await commitCount(remote, "main")).toBe(1);
  });

  it("refuses when there is no remote and no target", async () => {
    const repository = await repositoryWithHistory();

    await expect(
      publishRepository({
        repositoryPath: repository,
        branch: "main",
        confirmed: true,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isGitMosaicError(error) && error.code === "GM019",
    );
  });

  it("refuses a dirty worktree", async () => {
    const repository = await repositoryWithHistory();
    const remote = await bareRemote();
    await execa("touch", [path.join(repository, "stray.txt")]);
    await git(["add", "."], repository);

    await expect(
      publishRepository({
        repositoryPath: repository,
        branch: "main",
        remoteUrl: remote,
        confirmed: true,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isGitMosaicError(error) && error.code === "GM006",
    );
    expect(await commitCount(remote, "--all")).toBe(0);
  });

  it("refuses a branch that does not exist", async () => {
    const repository = await repositoryWithHistory();
    const remote = await bareRemote();

    await expect(
      publishRepository({
        repositoryPath: repository,
        branch: "does-not-exist",
        remoteUrl: remote,
        confirmed: true,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isGitMosaicError(error) && error.code === "GM019",
    );
  });

  it("refuses a directory that is not a repository", async () => {
    const directory = await temporary("git-mosaic-empty-");

    await expect(
      publishRepository({
        repositoryPath: directory,
        branch: "main",
        remoteUrl: "https://example.invalid/x.git",
        confirmed: true,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isGitMosaicError(error) && error.code === "GM019",
    );
  });

  it("pushes only the named branch, leaving others behind", async () => {
    const repository = await repositoryWithHistory();
    const remote = await bareRemote();
    await git(["branch", "secret"], repository);

    await publishRepository({
      repositoryPath: repository,
      branch: "main",
      remoteUrl: remote,
      confirmed: true,
    });

    const branches = await execa("git", ["branch", "--list"], { cwd: remote });
    expect(branches.stdout).toContain("main");
    expect(branches.stdout).not.toContain("secret");
  });
});
