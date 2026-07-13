import {
  access,
  appendFile,
  lstat,
  mkdir,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import {
  GitMosaicError,
  type CommitPlan,
  type PlannedCommit,
} from "@git-mosaic/schemas";
import { verifyCommitPlan } from "@git-mosaic/schemas/plan-integrity";

export type ApplicationState =
  "not_started" | "partial" | "complete" | "divergent";

export interface ExecutionProgress {
  step: number;
  total: number;
  date: string;
}

export interface CommitExecutorOptions {
  dryRun?: boolean;
  confirmed?: boolean;
  allowExistingRepository?: boolean;
  allowRepositoryWithRemotes?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: ExecutionProgress) => void | Promise<void>;
}

export interface ValidationReport {
  repositoryPath: string;
  repositoryMode: "new" | "existing";
  branch: string;
  applicationState: ApplicationState;
  appliedSteps: number;
  totalSteps: number;
  hasRemotes: boolean;
  remotes: string[];
  gitVersion: string;
  warnings: string[];
}

export interface ExecutionResult extends ValidationReport {
  status: "dry-run" | "complete" | "partial";
  createdCommits: number;
  head?: string;
}

interface FlatCommit {
  dayDate: string;
  planned: PlannedCommit;
  step: number;
}

interface RepositoryInspection {
  exists: boolean;
  isRepository: boolean;
  isEmptyDirectory: boolean;
  branch?: string;
  head?: string;
  clean: boolean;
  hasRemotes: boolean;
  remotes: string[];
  state: ApplicationState;
  appliedSteps: number;
}

function flattenPlan(plan: CommitPlan): FlatCommit[] {
  let step = 0;
  return plan.days.flatMap((day) =>
    day.commits.map((planned) => ({
      dayDate: day.date,
      planned,
      step: (step += 1),
    })),
  );
}

function expectedCommitBody(
  plan: CommitPlan,
  commit: FlatCommit,
  total: number,
): string {
  return `${commit.planned.message}\n\nGit-Mosaic-Plan: ${plan.planId}\nGit-Mosaic-Step: ${commit.step}/${total}\nGit-Mosaic-Date: ${commit.dayDate}`;
}

async function git(
  arguments_: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; reject?: boolean } = {},
) {
  return execa("git", arguments_, {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
    reject: options.reject ?? true,
    stdin: "ignore",
    all: false,
  });
}

async function gitVersion(): Promise<string> {
  try {
    const version = (await git(["--version"])).stdout.trim();
    const match = /(?:^|\s)(\d+)\.(\d+)(?:\.\d+)?/u.exec(version);
    if (
      match === null ||
      Number(match[1]) < 2 ||
      (Number(match[1]) === 2 && Number(match[2]) < 30)
    ) {
      throw new GitMosaicError(
        "GIT_NOT_FOUND",
        `Git 2.30 or newer is required; found ${version}`,
      );
    }
    return version;
  } catch (cause) {
    if (cause instanceof GitMosaicError) throw cause;
    throw new GitMosaicError(
      "GIT_NOT_FOUND",
      "Git is not installed or cannot be executed",
      { cause },
    );
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function inspectApplication(
  repositoryPath: string,
  plan: CommitPlan,
  flatCommits: FlatCommit[],
): Promise<{ state: ApplicationState; appliedSteps: number }> {
  const log = await git(["log", `--format=%B%x00`], {
    cwd: repositoryPath,
    reject: false,
  });
  if (log.exitCode !== 0) return { state: "not_started", appliedSteps: 0 };
  const bodies = log.stdout
    .split("\0")
    .map((body) => body.trim())
    .filter(Boolean);
  const bodiesByStep = new Map<number, string>();
  for (const body of bodies) {
    const planMatch = /^Git-Mosaic-Plan: ([a-f0-9]{16})$/m.exec(body);
    if (planMatch?.[1] !== plan.planId) continue;
    const stepMatch = /^Git-Mosaic-Step: (\d+)\/(\d+)$/m.exec(body);
    if (stepMatch === null || Number(stepMatch[2]) !== flatCommits.length) {
      return { state: "divergent", appliedSteps: 0 };
    }
    const step = Number(stepMatch[1]);
    if (step < 1 || step > flatCommits.length || bodiesByStep.has(step)) {
      return { state: "divergent", appliedSteps: 0 };
    }
    bodiesByStep.set(step, body);
  }

  if (bodiesByStep.size === 0) return { state: "not_started", appliedSteps: 0 };
  for (let step = 1; step <= bodiesByStep.size; step += 1) {
    const body = bodiesByStep.get(step);
    const expected = expectedCommitBody(
      plan,
      flatCommits[step - 1]!,
      flatCommits.length,
    );
    if (body === undefined || body.trimEnd() !== expected.trimEnd()) {
      return { state: "divergent", appliedSteps: bodiesByStep.size };
    }
  }
  return bodiesByStep.size === flatCommits.length
    ? { state: "complete", appliedSteps: bodiesByStep.size }
    : { state: "partial", appliedSteps: bodiesByStep.size };
}

async function inspectRepository(
  plan: CommitPlan,
  flatCommits: FlatCommit[],
): Promise<RepositoryInspection> {
  const repositoryPath = path.resolve(plan.repository.path);
  const pathExists = await exists(repositoryPath);
  if (!pathExists) {
    return {
      exists: false,
      isRepository: false,
      isEmptyDirectory: true,
      clean: true,
      hasRemotes: false,
      remotes: [],
      state: "not_started",
      appliedSteps: 0,
    };
  }
  const entry = await stat(repositoryPath);
  if (!entry.isDirectory()) {
    throw new GitMosaicError(
      "EXISTING_REPOSITORY_NOT_ALLOWED",
      `Repository path is not a directory: ${repositoryPath}`,
    );
  }
  const directoryEntries = await readdir(repositoryPath);
  const isEmptyDirectory = directoryEntries.length === 0;
  const repositoryCheck = await git(["rev-parse", "--is-inside-work-tree"], {
    cwd: repositoryPath,
    reject: false,
  });
  const isRepository =
    repositoryCheck.exitCode === 0 && repositoryCheck.stdout.trim() === "true";
  if (!isRepository) {
    return {
      exists: true,
      isRepository: false,
      isEmptyDirectory,
      clean: isEmptyDirectory,
      hasRemotes: false,
      remotes: [],
      state: "not_started",
      appliedSteps: 0,
    };
  }
  const status = await git(["status", "--porcelain=v1", "-z"], {
    cwd: repositoryPath,
  });
  const branchResult = await git(["branch", "--show-current"], {
    cwd: repositoryPath,
  });
  const headResult = await git(["rev-parse", "--verify", "HEAD"], {
    cwd: repositoryPath,
    reject: false,
  });
  const remoteResult = await git(["remote"], { cwd: repositoryPath });
  const remotes = remoteResult.stdout
    .split(/\r?\n/u)
    .map((remote) => remote.trim())
    .filter(Boolean);
  const application = await inspectApplication(
    repositoryPath,
    plan,
    flatCommits,
  );
  return {
    exists: true,
    isRepository: true,
    isEmptyDirectory,
    ...(branchResult.stdout.trim() === ""
      ? {}
      : { branch: branchResult.stdout.trim() }),
    ...(headResult.exitCode === 0 ? { head: headResult.stdout.trim() } : {}),
    clean: status.stdout.length === 0,
    hasRemotes: remotes.length > 0,
    remotes,
    ...application,
  };
}

async function validateExpectedBase(
  plan: CommitPlan,
  inspection: RepositoryInspection,
  repositoryPath: string,
): Promise<void> {
  if (plan.repository.mode !== "existing") return;
  if (plan.repository.expectedHead === undefined) {
    throw new GitMosaicError(
      "EXISTING_REPOSITORY_NOT_ALLOWED",
      "Existing repository plans require expectedHead",
    );
  }
  if (
    inspection.state === "not_started" &&
    inspection.head !== plan.repository.expectedHead
  ) {
    throw new GitMosaicError(
      "EXISTING_REPOSITORY_NOT_ALLOWED",
      "Repository HEAD differs from the planned base",
      {
        hint: `Expected ${plan.repository.expectedHead}, found ${inspection.head ?? "no HEAD"}`,
      },
    );
  }
  if (inspection.state === "partial" || inspection.state === "complete") {
    const ancestor = await git(
      ["merge-base", "--is-ancestor", plan.repository.expectedHead, "HEAD"],
      {
        cwd: repositoryPath,
        reject: false,
      },
    );
    if (ancestor.exitCode !== 0) {
      throw new GitMosaicError(
        "EXISTING_REPOSITORY_NOT_ALLOWED",
        "Planned base is not an ancestor of HEAD",
      );
    }
  }
}

export async function validateCommitPlanExecution(
  plan: CommitPlan,
  options: CommitExecutorOptions = {},
): Promise<ValidationReport> {
  const version = await gitVersion();
  const repositoryPath = path.resolve(plan.repository.path);
  const flatCommits = flattenPlan(plan);
  const inspection = await inspectRepository(plan, flatCommits);

  if (!inspection.clean) {
    throw new GitMosaicError(
      "REPOSITORY_DIRTY",
      `Repository has uncommitted changes: ${repositoryPath}`,
    );
  }
  if (inspection.state === "divergent") {
    throw new GitMosaicError(
      "PLAN_ALREADY_APPLIED",
      "Repository contains a divergent application of this plan",
    );
  }
  if (inspection.state === "complete") {
    throw new GitMosaicError(
      "PLAN_ALREADY_APPLIED",
      `Plan ${plan.planId} is already fully applied`,
    );
  }

  if (plan.repository.mode === "new") {
    const validNewTarget =
      !inspection.exists ||
      inspection.isEmptyDirectory ||
      inspection.isRepository;
    if (!validNewTarget) {
      throw new GitMosaicError(
        "EXISTING_REPOSITORY_NOT_ALLOWED",
        `New repository target is not empty: ${repositoryPath}`,
      );
    }
    if (
      inspection.isRepository &&
      inspection.state === "not_started" &&
      inspection.head !== undefined
    ) {
      throw new GitMosaicError(
        "EXISTING_REPOSITORY_NOT_ALLOWED",
        `New repository target already has commits: ${repositoryPath}`,
      );
    }
  } else {
    if (!options.allowExistingRepository) {
      throw new GitMosaicError(
        "EXISTING_REPOSITORY_NOT_ALLOWED",
        "Existing repository requires explicit authorization",
        {
          hint: "Use --allow-existing-repository after reviewing the repository path and branch",
        },
      );
    }
    if (!inspection.isRepository) {
      throw new GitMosaicError(
        "EXISTING_REPOSITORY_NOT_ALLOWED",
        `Not a Git repository: ${repositoryPath}`,
      );
    }
  }

  if (inspection.isRepository && inspection.branch !== plan.repository.branch) {
    throw new GitMosaicError(
      "EXISTING_REPOSITORY_NOT_ALLOWED",
      "Current branch differs from the plan",
      {
        hint: `Expected ${plan.repository.branch}, found ${inspection.branch ?? "detached HEAD"}`,
      },
    );
  }
  if (inspection.hasRemotes && !options.allowRepositoryWithRemotes) {
    throw new GitMosaicError(
      "EXISTING_REPOSITORY_NOT_ALLOWED",
      "Repository has configured remotes",
      {
        hint: "Use --allow-repository-with-remotes after reviewing every remote; git-mosaic will not push",
      },
    );
  }
  await validateExpectedBase(plan, inspection, repositoryPath);

  return {
    repositoryPath,
    repositoryMode: plan.repository.mode,
    branch: plan.repository.branch,
    applicationState: inspection.state,
    appliedSteps: inspection.appliedSteps,
    totalSteps: flatCommits.length,
    hasRemotes: inspection.hasRemotes,
    remotes: inspection.remotes,
    gitVersion: version,
    warnings: [
      "GitHub may calculate contribution colors differently.",
      "Generated commits represent contribution artwork, not development activity.",
    ],
  };
}

function commitEnvironment(
  plan: CommitPlan,
  timestamp: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: plan.author.name,
    GIT_AUTHOR_EMAIL: plan.author.email,
    GIT_AUTHOR_DATE: timestamp,
    GIT_COMMITTER_NAME: plan.committer.name,
    GIT_COMMITTER_EMAIL: plan.committer.email,
    GIT_COMMITTER_DATE: timestamp,
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function ensureSafeFileTarget(
  repositoryPath: string,
  filePath: string,
): Promise<{ relative: string; absolute: string }> {
  const segments = filePath
    .split(/[\\/]/u)
    .filter((segment) => segment !== "" && segment !== ".");
  if (
    filePath.includes("\0") ||
    path.posix.isAbsolute(filePath) ||
    path.win32.isAbsolute(filePath) ||
    segments.length === 0 ||
    segments.includes("..") ||
    segments[0]?.toLowerCase() === ".git"
  ) {
    throw new GitMosaicError(
      "INVALID_PROJECT",
      `Unsafe commit file path: ${filePath}`,
    );
  }
  const repositoryRoot = path.resolve(repositoryPath);
  const absolute = path.resolve(repositoryRoot, ...segments);
  if (!absolute.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new GitMosaicError(
      "INVALID_PROJECT",
      `Commit file escapes repository: ${filePath}`,
    );
  }

  let current = repositoryRoot;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw new GitMosaicError(
          "INVALID_PROJECT",
          `Commit file path contains a symlink: ${filePath}`,
        );
      }
      if (index < segments.length - 1 && !entry.isDirectory()) {
        throw new GitMosaicError(
          "INVALID_PROJECT",
          `Commit file parent is not a directory: ${filePath}`,
        );
      }
    } catch (cause) {
      if (cause instanceof GitMosaicError) throw cause;
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      if (index < segments.length - 1) await mkdir(current);
    }
  }
  return { relative: segments.join(path.sep), absolute };
}

async function ensureRepository(
  plan: CommitPlan,
  report: ValidationReport,
): Promise<void> {
  if (await exists(path.join(report.repositoryPath, ".git"))) return;
  await mkdir(report.repositoryPath, { recursive: true });
  await git(["init", "-b", plan.repository.branch], {
    cwd: report.repositoryPath,
  });
}

export async function applyCommitPlan(
  plan: CommitPlan,
  options: CommitExecutorOptions = {},
): Promise<ExecutionResult> {
  verifyCommitPlan(plan);
  const report = await validateCommitPlanExecution(plan, options);
  if (options.dryRun) {
    return { ...report, status: "dry-run", createdCommits: 0 };
  }
  if (!options.confirmed) {
    throw new GitMosaicError(
      "EXISTING_REPOSITORY_NOT_ALLOWED",
      "Commit materialization requires explicit confirmation",
    );
  }
  await ensureRepository(plan, report);
  if (report.totalSteps === 0) {
    return {
      ...report,
      applicationState: "complete",
      status: "complete",
      createdCommits: 0,
    };
  }
  const hooksDirectory = path.join(
    report.repositoryPath,
    ".git",
    "git-mosaic-empty-hooks",
  );
  await mkdir(hooksDirectory, { recursive: true });
  const flatCommits = flattenPlan(plan);
  let createdCommits = 0;

  for (const commit of flatCommits.slice(report.appliedSteps)) {
    if (options.signal?.aborted) break;
    if (plan.strategy.commitMode === "file") {
      const fileTarget = await ensureSafeFileTarget(
        report.repositoryPath,
        plan.strategy.filePath ?? ".git-mosaic/activity.log",
      );
      await appendFile(
        fileTarget.absolute,
        `${commit.planned.timestamp}\t${plan.planId}\t${commit.step}/${flatCommits.length}\n`,
        "utf8",
      );
      await git(["add", "--", fileTarget.relative], {
        cwd: report.repositoryPath,
      });
    }
    const trailers = `Git-Mosaic-Plan: ${plan.planId}\nGit-Mosaic-Step: ${commit.step}/${flatCommits.length}\nGit-Mosaic-Date: ${commit.dayDate}`;
    const arguments_ = [
      "-c",
      "commit.gpgSign=false",
      "-c",
      `core.hooksPath=${hooksDirectory}`,
      "commit",
      "--no-verify",
      "--no-gpg-sign",
      "--cleanup=verbatim",
      ...(plan.strategy.commitMode === "empty" ? ["--allow-empty"] : []),
      "-m",
      commit.planned.message,
      "-m",
      trailers,
    ];
    await git(arguments_, {
      cwd: report.repositoryPath,
      env: commitEnvironment(plan, commit.planned.timestamp),
    });
    createdCommits += 1;
    await options.onProgress?.({
      step: commit.step,
      total: flatCommits.length,
      date: commit.dayDate,
    });
  }

  const finalInspection = await inspectRepository(plan, flatCommits);
  if (
    finalInspection.state !== "complete" &&
    finalInspection.state !== "partial"
  ) {
    throw new GitMosaicError(
      "PLAN_ALREADY_APPLIED",
      "Post-apply verification found an unexpected repository state",
    );
  }
  return {
    ...report,
    applicationState: finalInspection.state,
    appliedSteps: finalInspection.appliedSteps,
    status: finalInspection.state === "complete" ? "complete" : "partial",
    createdCommits,
    ...(finalInspection.head === undefined
      ? {}
      : { head: finalInspection.head }),
  };
}
