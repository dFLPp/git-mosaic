import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { commitTimestamp, todayInTimezone } from "@git-mosaic/calendar";
import {
  commitPlanSchema,
  GitMosaicError,
  type CommitPlan,
  type MosaicProject,
} from "@git-mosaic/schemas";
import {
  calculatePlanChecksum,
  verifyCommitPlan,
} from "@git-mosaic/schemas/plan-integrity";
import { buildPreviewCalendar } from "./preview.js";
import { DEFAULT_MESSAGE_TEMPLATE, renderMessage } from "./messages.js";

export {
  DEFAULT_MESSAGE_TEMPLATE,
  defaultReadme,
  previewCommitMessage,
  renderMessage,
} from "./messages.js";

export {
  calculatePlanChecksum,
  verifyCommitPlan,
} from "@git-mosaic/schemas/plan-integrity";

export interface CommitPlannerInput {
  project: MosaicProject;
  repository: {
    path: string;
    branch: string;
    mode: "new" | "existing";
    expectedHead?: string;
  };
  author: { name: string; email: string };
  committer?: { name: string; email: string };
  commitMode?: "empty" | "file";
  filePath?: string;
  messageTemplate?: string;
  /** Files written into the plan's first commit, e.g. a README.md. */
  files?: readonly { path: string; content: string }[];
  maximumCommitsPerDay?: number;
  maximumTotalCommits?: number;
  allowLargePlan?: boolean;
  allowFuture?: boolean;
  generatedAt?: string;
}

export function createCommitPlan(input: CommitPlannerInput): CommitPlan {
  const maximumCommitsPerDay = input.maximumCommitsPerDay ?? 50;
  const maximumTotalCommits = input.maximumTotalCommits ?? 5_000;
  const messageTemplate = input.messageTemplate ?? DEFAULT_MESSAGE_TEMPLATE;
  const commitMode = input.commitMode ?? "empty";
  const committer = input.committer ?? input.author;
  if (
    !input.author.name.trim() ||
    !input.author.email.trim() ||
    !committer.name.trim() ||
    !committer.email.trim()
  ) {
    throw new GitMosaicError(
      "INVALID_AUTHOR",
      "Author and committer identity are required",
    );
  }
  if (commitMode === "file" && !input.filePath) {
    throw new GitMosaicError(
      "INVALID_PROJECT",
      "File commit mode requires a file path",
    );
  }

  const preview = buildPreviewCalendar(input.project);
  const currentDate = todayInTimezone(input.project.timezone);
  const days = preview.cells
    .flat()
    .filter((cell) => cell.inRange && cell.plannedCount > 0)
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((cell) => {
      if (cell.plannedCount > maximumCommitsPerDay && !input.allowLargePlan) {
        throw new GitMosaicError(
          "PLAN_TOO_LARGE",
          `Plan exceeds the per-day limit on ${cell.date}`,
          {
            hint: `Maximum is ${maximumCommitsPerDay}; use --allow-large-plan after reviewing the plan`,
          },
        );
      }
      if (cell.date > currentDate && !input.allowFuture) {
        throw new GitMosaicError(
          "FUTURE_DATE_NOT_ALLOWED",
          `Plan contains a future date: ${cell.date}`,
        );
      }
      const commits = Array.from({ length: cell.plannedCount }, (_, offset) => {
        const timestamp = commitTimestamp(
          cell.date,
          input.project.timezone,
          offset,
        );
        const index = offset + 1;
        return {
          index,
          timestamp,
          message: renderMessage(messageTemplate, {
            date: cell.date,
            timestamp,
            index,
            total: cell.plannedCount,
            intensity: cell.intensity,
            project: input.project.name,
          }),
        };
      });
      return {
        date: cell.date,
        intensity: cell.intensity,
        existingCount: cell.existingCount,
        commitsToCreate: cell.plannedCount,
        expectedFinalCount: cell.finalCount,
        expectedLevel: cell.level,
        commits,
      };
    });
  const totalCommits = days.reduce((sum, day) => sum + day.commitsToCreate, 0);
  if (totalCommits > maximumTotalCommits && !input.allowLargePlan) {
    throw new GitMosaicError(
      "PLAN_TOO_LARGE",
      `Plan contains ${totalCommits} commits`,
      {
        hint: `Maximum is ${maximumTotalCommits}; use --allow-large-plan after reviewing the plan`,
      },
    );
  }

  const withoutIdentity = {
    schemaVersion: 1 as const,
    projectName: input.project.name,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    timezone: input.project.timezone,
    repository: {
      path: path.resolve(input.repository.path),
      branch: input.repository.branch,
      mode: input.repository.mode,
      ...(input.repository.expectedHead === undefined
        ? {}
        : { expectedHead: input.repository.expectedHead }),
    },
    author: input.author,
    committer,
    strategy: {
      commitMode,
      ...(input.filePath === undefined ? {} : { filePath: input.filePath }),
      levelMap: input.project.commitLevelMap,
      messageTemplate,
    },
    ...(input.files === undefined || input.files.length === 0
      ? {}
      : { files: input.files.map((file) => ({ ...file })) }),
    totals: {
      days: days.length,
      commits: totalCommits,
      maximumCommitsPerDay: days.reduce(
        (maximum, day) => Math.max(maximum, day.commitsToCreate),
        0,
      ),
    },
    days,
  };
  const checksum = calculatePlanChecksum(
    withoutIdentity as Omit<CommitPlan, "checksum" | "planId">,
  );
  return commitPlanSchema.parse({
    ...withoutIdentity,
    planId: checksum.slice(0, 16),
    checksum,
  });
}

export async function writeCommitPlan(
  filePath: string,
  plan: CommitPlan,
): Promise<void> {
  const verified = verifyCommitPlan(plan);
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  const target = path.resolve(filePath);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(verified, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export async function readCommitPlan(filePath: string): Promise<CommitPlan> {
  try {
    return verifyCommitPlan(
      JSON.parse(await readFile(path.resolve(filePath), "utf8")) as unknown,
    );
  } catch (cause) {
    if (cause instanceof GitMosaicError) throw cause;
    throw new GitMosaicError(
      "INVALID_PROJECT",
      `Could not read commit plan: ${filePath}`,
      { cause },
    );
  }
}
