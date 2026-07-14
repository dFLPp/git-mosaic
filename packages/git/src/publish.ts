import { execa } from "execa";
import { GitMosaicError } from "@git-mosaic/schemas";

export type RemoteVisibility = "public" | "private";

export interface PublishInput {
  repositoryPath: string;
  branch: string;
  /** Remote to push to. Created if missing. */
  remoteName?: string;
  /** Attach an existing remote by URL instead of creating a repository. */
  remoteUrl?: string;
  /** Create the GitHub repository with the GitHub CLI. */
  createRepository?: { name: string; visibility: RemoteVisibility };
  /**
   * Publishing is the only outward-facing action in git-mosaic. Without an
   * explicit `true` the call reports what it would do and touches nothing.
   */
  confirmed?: boolean;
}

export interface PublishReport {
  repositoryPath: string;
  branch: string;
  remoteName: string;
  /** Known before publishing only when a remote or URL already exists. */
  remoteUrl?: string;
  willCreateRepository: boolean;
  /** Commits that a push would upload. */
  commitsToPush: number;
  githubAccount?: string;
  status: "dry-run" | "published";
  warnings: string[];
}

async function git(arguments_: string[], cwd: string, reject = true) {
  return execa("git", arguments_, { cwd, reject, stdin: "ignore" });
}

async function isClean(repositoryPath: string): Promise<boolean> {
  const status = await git(["status", "--porcelain"], repositoryPath);
  return status.stdout.trim() === "";
}

async function remoteUrlOf(
  repositoryPath: string,
  remoteName: string,
): Promise<string | undefined> {
  const result = await git(
    ["remote", "get-url", remoteName],
    repositoryPath,
    false,
  );
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

/** Commits that a push would upload: everything the remote branch lacks. */
async function commitsToPush(
  repositoryPath: string,
  branch: string,
  remoteName: string,
  remoteKnown: boolean,
): Promise<number> {
  if (remoteKnown) {
    const range = await git(
      ["rev-list", "--count", `${remoteName}/${branch}..${branch}`],
      repositoryPath,
      false,
    );
    if (range.exitCode === 0) return Number(range.stdout.trim());
  }
  const all = await git(["rev-list", "--count", branch], repositoryPath);
  return Number(all.stdout.trim());
}

async function requireGithubCli(): Promise<string> {
  const version = await execa("gh", ["--version"], {
    reject: false,
    stdin: "ignore",
  });
  if (version.exitCode !== 0) {
    throw new GitMosaicError(
      "GITHUB_CLI_UNAVAILABLE",
      "The GitHub CLI (gh) is required to create a repository",
      {
        hint: "Install gh from https://cli.github.com, or pass an existing remote URL instead",
      },
    );
  }
  const account = await execa("gh", ["api", "user", "--jq", ".login"], {
    reject: false,
    stdin: "ignore",
  });
  if (account.exitCode !== 0) {
    throw new GitMosaicError(
      "GITHUB_AUTH_FAILED",
      "The GitHub CLI is not authenticated",
      { hint: "Run `gh auth login`, then try again" },
    );
  }
  return account.stdout.trim();
}

/**
 * Pushes a generated mosaic repository to GitHub.
 *
 * This is the only command in git-mosaic that reaches the network. It never
 * force-pushes, never rewrites history, and never touches a branch other than
 * the one named. Without `confirmed: true` it is a dry run.
 */
export async function publishRepository(
  input: PublishInput,
): Promise<PublishReport> {
  const { repositoryPath, branch } = input;
  const remoteName = input.remoteName ?? "origin";
  const warnings: string[] = [];

  const inside = await git(
    ["rev-parse", "--is-inside-work-tree"],
    repositoryPath,
    false,
  );
  if (inside.exitCode !== 0) {
    throw new GitMosaicError(
      "PUBLISH_TARGET_MISSING",
      `${repositoryPath} is not a Git repository`,
      { hint: "Apply a plan first; publishing only pushes what apply created" },
    );
  }

  const branchExists = await git(
    ["rev-parse", "--verify", `refs/heads/${branch}`],
    repositoryPath,
    false,
  );
  if (branchExists.exitCode !== 0) {
    throw new GitMosaicError(
      "PUBLISH_TARGET_MISSING",
      `Branch ${branch} does not exist in ${repositoryPath}`,
    );
  }

  if (!(await isClean(repositoryPath))) {
    throw new GitMosaicError(
      "REPOSITORY_DIRTY",
      "The repository has uncommitted changes",
      { hint: "Commit or discard them before publishing" },
    );
  }

  const existingUrl = await remoteUrlOf(repositoryPath, remoteName);
  const willCreateRepository =
    existingUrl === undefined &&
    input.remoteUrl === undefined &&
    input.createRepository !== undefined;

  if (
    existingUrl === undefined &&
    input.remoteUrl === undefined &&
    input.createRepository === undefined
  ) {
    throw new GitMosaicError(
      "PUBLISH_TARGET_MISSING",
      `No remote named ${remoteName} and no target was given`,
      {
        hint: "Pass a remote URL, or ask git-mosaic to create the repository with gh",
      },
    );
  }

  if (existingUrl !== undefined && input.remoteUrl !== undefined) {
    warnings.push(
      `Remote ${remoteName} already points at ${existingUrl}; the supplied URL was ignored`,
    );
  }

  let githubAccount: string | undefined;
  if (willCreateRepository) githubAccount = await requireGithubCli();

  const resolvedUrl = existingUrl ?? input.remoteUrl;
  const pushCount = await commitsToPush(
    repositoryPath,
    branch,
    remoteName,
    existingUrl !== undefined,
  );

  warnings.push(
    "Pushed commits are contribution artwork, not development activity. Disclose that in the repository.",
  );

  const report: PublishReport = {
    repositoryPath,
    branch,
    remoteName,
    ...(resolvedUrl === undefined ? {} : { remoteUrl: resolvedUrl }),
    willCreateRepository,
    commitsToPush: pushCount,
    ...(githubAccount === undefined ? {} : { githubAccount }),
    status: "dry-run",
    warnings,
  };

  if (input.confirmed !== true) return report;

  if (willCreateRepository && input.createRepository !== undefined) {
    // `gh repo create --source` wires the remote up but does not push on its own.
    await execa(
      "gh",
      [
        "repo",
        "create",
        input.createRepository.name,
        `--${input.createRepository.visibility}`,
        "--source",
        repositoryPath,
        "--remote",
        remoteName,
      ],
      { stdin: "ignore" },
    );
  } else if (existingUrl === undefined && input.remoteUrl !== undefined) {
    await git(["remote", "add", remoteName, input.remoteUrl], repositoryPath);
  }

  await git(
    ["push", "--set-upstream", remoteName, `${branch}:${branch}`],
    repositoryPath,
  );

  const publishedUrl = await remoteUrlOf(repositoryPath, remoteName);
  return {
    ...report,
    ...(publishedUrl === undefined ? {} : { remoteUrl: publishedUrl }),
    status: "published",
  };
}
