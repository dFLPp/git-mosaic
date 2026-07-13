import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  civilYearRange,
  rollingYearRange,
  todayInTimezone,
} from "@git-mosaic/calendar";
import {
  createCommitPlan,
  GitMosaicError,
  importGitHubContributions,
  importImage,
  importMatrix,
  importText,
  initializeProject,
  readCommitPlan,
  readProject,
  renderProjectSvg,
  renderProjectTerminal,
  writeCommitPlan,
  writePreview,
} from "@git-mosaic/core";
import { applyCommitPlan } from "@git-mosaic/git";
import { GitHubGraphQLProvider } from "@git-mosaic/github";
import type { CommitLevelMap, DateRange, FitReport } from "@git-mosaic/schemas";
import { Command, InvalidArgumentError, Option } from "commander";

export const cliVersion = "0.1.0";

interface InitOptions {
  directory?: string;
  year?: string;
  period?: "rolling-year";
  from?: string;
  to?: string;
  timezone: string;
}

function resolveInitPeriod(options: InitOptions): DateRange {
  const hasCustomBoundary =
    options.from !== undefined || options.to !== undefined;
  const selectedModes =
    Number(options.year !== undefined) +
    Number(options.period !== undefined) +
    Number(hasCustomBoundary);
  if (selectedModes > 1) {
    throw new GitMosaicError(
      "INVALID_DATE_RANGE",
      "Conflicting period options",
      {
        hint: "Choose only one of --year, --period, or --from/--to",
      },
    );
  }
  if (hasCustomBoundary) {
    if (options.from === undefined || options.to === undefined) {
      throw new GitMosaicError(
        "INVALID_DATE_RANGE",
        "Incomplete custom period",
        {
          hint: "Custom periods require both --from and --to",
        },
      );
    }
    return { from: options.from, to: options.to };
  }
  if (options.year !== undefined) return civilYearRange(Number(options.year));
  return rollingYearRange(todayInTimezone(options.timezone));
}

async function confirmApplication(
  planId: string,
  repositoryPath: string,
): Promise<boolean> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw new GitMosaicError(
      "EXISTING_REPOSITORY_NOT_ALLOWED",
      "Interactive confirmation requires a terminal",
      {
        hint: "Review the dry-run and pass --yes for intentional non-interactive execution",
      },
    );
  }
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await readline.question(
      `Repository: ${repositoryPath}\nType plan id ${planId} to materialize commits: `,
    );
    return answer.trim() === planId;
  } finally {
    readline.close();
  }
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("Expected a positive integer");
  }
  return parsed;
}

function commitLevels(value: string): CommitLevelMap {
  const counts = value.split(",").map(Number);
  if (
    counts.length !== 5 ||
    counts[0] !== 0 ||
    counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
    counts.some((count, index) => index > 0 && count < counts[index - 1]!)
  ) {
    throw new InvalidArgumentError(
      "Expected five non-decreasing integers beginning with zero, e.g. 0,1,4,10,20",
    );
  }
  return { 0: 0, 1: counts[1]!, 2: counts[2]!, 3: counts[3]!, 4: counts[4]! };
}

function writeOutput(program: Command, message: string): void {
  if (program.opts<{ quiet?: boolean }>().quiet !== true) {
    process.stdout.write(message);
  }
}

function formatFitReport(report: FitReport): string {
  const lines = [
    `Fit: ${report.verdict.toUpperCase()} (score ${report.score.toFixed(2)})`,
  ];
  if (report.survives.length > 0)
    lines.push(`Survives: ${report.survives.join("; ")}`);
  if (report.lost.length > 0) lines.push(`Lost: ${report.lost.join("; ")}`);
  if (report.remedies.length > 0)
    lines.push(`Try: ${report.remedies.join("; ")}`);
  return `${lines.join("\n")}\n`;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("git-mosaic")
    .description(
      "Create contribution art through a preview-first, deterministic workflow",
    )
    .version(cliVersion)
    .option("--quiet", "only print errors")
    .option("--verbose", "print verbose diagnostics")
    .option("--debug", "print debug diagnostics");

  program
    .command("init")
    .description("create a new mosaic project")
    .argument("[name]", "project name", "my-mosaic")
    .option("--directory <path>", "project directory")
    .option("--year <year>", "use a civil year")
    .addOption(
      new Option("--period <preset>", "use a period preset").choices([
        "rolling-year",
      ]),
    )
    .option("--from <date>", "inclusive custom start date")
    .option("--to <date>", "inclusive custom end date")
    .option(
      "--timezone <timezone>",
      "IANA timezone",
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
    .action(async (name: string, options: InitOptions) => {
      const directory = path.resolve(options.directory ?? name);
      const project = await initializeProject(directory, {
        name,
        period: resolveInitPeriod(options),
        timezone: options.timezone,
      });
      writeOutput(program, `Created ${project.name} at ${directory}\n`);
    });

  const importCommand = program
    .command("import")
    .description("import an image, text, or intensity matrix");
  importCommand
    .command("matrix")
    .description("import a JSON intensity matrix")
    .argument("<input>", "JSON matrix file")
    .requiredOption("--project <path>", "mosaic project directory")
    .action(async (input: string, options: { project: string }) => {
      const project = await importMatrix(
        path.resolve(options.project),
        path.resolve(input),
      );
      writeOutput(program, `Imported matrix into ${project.name}\n`);
    });
  importCommand
    .command("image")
    .description("import a PNG, JPEG, or WebP image")
    .argument("<input>", "image file")
    .requiredOption("--project <path>", "mosaic project directory")
    .addOption(
      new Option("--fit <mode>", "image fitting mode")
        .choices(["contain", "cover", "stretch"])
        .default("contain"),
    )
    .addOption(
      new Option("--mode <mode>", "quantization mode")
        .choices(["levels", "binary"])
        .default("levels"),
    )
    .option("--invert", "invert intensity levels")
    .option("--contrast <multiplier>", "contrast multiplier", Number)
    .option(
      "--no-normalize",
      "keep the original histogram instead of stretching it",
    )
    .option("--dither", "diffuse quantization error for smooth gradients")
    .option("--force", "import even when the fit verdict is bad")
    .action(
      async (
        input: string,
        options: {
          project: string;
          fit: "contain" | "cover" | "stretch";
          mode: "levels" | "binary";
          invert?: boolean;
          contrast?: number;
          normalize: boolean;
          dither?: boolean;
          force?: boolean;
        },
      ) => {
        const projectDirectory = path.resolve(options.project);
        const { project, report } = await importImage(
          projectDirectory,
          path.resolve(input),
          {
            fit: options.fit,
            mode: options.mode,
            invert: options.invert ?? false,
            normalize: options.normalize,
            dithering: options.dither ?? false,
            force: options.force ?? false,
            ...(options.contrast === undefined
              ? {}
              : { contrast: options.contrast }),
          },
        );
        writeOutput(program, `Imported image into ${project.name}\n`);
        writeOutput(program, formatFitReport(report));
        writeOutput(
          program,
          await renderProjectTerminal(projectDirectory, {
            color: process.stdout.isTTY === true,
          }),
        );
      },
    );
  importCommand
    .command("text")
    .description("render text onto the calendar with a built-in pixel font")
    .argument("<content>", "text to render (A-Z, 0-9, space, . ! ? - :)")
    .requiredOption("--project <path>", "mosaic project directory")
    .addOption(
      new Option("--align <align>", "horizontal alignment")
        .choices(["left", "center", "right"])
        .default("center"),
    )
    .action(
      async (
        content: string,
        options: {
          project: string;
          align: "left" | "center" | "right";
        },
      ) => {
        const projectDirectory = path.resolve(options.project);
        const { project, report } = await importText(
          projectDirectory,
          content,
          { align: options.align },
        );
        writeOutput(program, `Imported text into ${project.name}\n`);
        writeOutput(program, formatFitReport(report));
        writeOutput(
          program,
          await renderProjectTerminal(projectDirectory, {
            color: process.stdout.isTTY === true,
          }),
        );
      },
    );

  program
    .command("preview")
    .description("preview a project without touching Git")
    .requiredOption("--project <path>", "mosaic project directory")
    .option("--output <file>", "write an SVG preview")
    .addOption(
      new Option("--theme <theme>", "preview theme")
        .choices(["light", "dark"])
        .default("dark"),
    )
    .option("--no-months", "hide month labels")
    .option("--no-weekdays", "hide weekday labels")
    .option("--no-legend", "hide the legend")
    .option("--no-color", "disable ANSI colors in terminal output")
    .option("--cell-size <number>", "cell size", Number)
    .option("--cell-gap <number>", "cell gap", Number)
    .option(
      "--estimate",
      "rank levels like GitHub's quartile estimate instead of showing drawn intensities",
    )
    .action(
      async (options: {
        project: string;
        output?: string;
        theme: "light" | "dark";
        months: boolean;
        weekdays: boolean;
        legend: boolean;
        color: boolean;
        cellSize?: number;
        cellGap?: number;
        estimate?: boolean;
      }) => {
        const renderOptions = {
          theme: options.theme,
          showMonths: options.months,
          showWeekdays: options.weekdays,
          showLegend: options.legend,
          ...(options.cellSize === undefined
            ? {}
            : { cellSize: options.cellSize }),
          ...(options.cellGap === undefined
            ? {}
            : { cellGap: options.cellGap }),
        };
        if (options.output !== undefined) {
          const output = path.resolve(options.output);
          await writePreview(
            output,
            await renderProjectSvg(
              path.resolve(options.project),
              renderOptions,
              options.estimate === true ? "estimate" : "artistic",
            ),
          );
          writeOutput(program, `Wrote SVG preview to ${output}\n`);
          return;
        }
        writeOutput(
          program,
          await renderProjectTerminal(
            path.resolve(options.project),
            {
              ...renderOptions,
              color: options.color && process.stdout.isTTY === true,
            },
            options.estimate === true ? "estimate" : "artistic",
          ),
        );
      },
    );

  const planCommand = program
    .command("plan")
    .description("create or inspect a deterministic commit plan")
    .option("--project <path>", "mosaic project directory")
    .option("--repo <path>", "target repository path")
    .option("--branch <name>", "target branch", "main")
    .addOption(
      new Option("--repository-mode <mode>", "repository mode")
        .choices(["new", "existing"])
        .default("new"),
    )
    .option(
      "--expected-head <hash>",
      "expected HEAD for an existing repository",
    )
    .option("--author-name <name>", "commit author name")
    .option("--author-email <email>", "commit author email")
    .option("--committer-name <name>", "commit committer name")
    .option("--committer-email <email>", "commit committer email")
    .addOption(
      new Option("--commit-mode <mode>", "commit mode")
        .choices(["empty", "file"])
        .default("empty"),
    )
    .option("--file-path <path>", "file changed in file mode")
    .option("--message-template <template>", "commit message template")
    .option(
      "--levels <counts>",
      "commit counts for intensities 0–4",
      commitLevels,
    )
    .option(
      "--max-commits-per-day <count>",
      "maximum commits allowed on one day",
      positiveInteger,
    )
    .option(
      "--max-total-commits <count>",
      "maximum commits allowed in the plan",
      positiveInteger,
    )
    .option("--output <file>", "plan output file")
    .option("--allow-large-plan", "allow configured plan limits to be exceeded")
    .option("--allow-future", "allow commits with future dates")
    .action(
      async (options: {
        project?: string;
        repo?: string;
        branch: string;
        repositoryMode: "new" | "existing";
        expectedHead?: string;
        authorName?: string;
        authorEmail?: string;
        committerName?: string;
        committerEmail?: string;
        commitMode: "empty" | "file";
        filePath?: string;
        messageTemplate?: string;
        levels?: CommitLevelMap;
        maxCommitsPerDay?: number;
        maxTotalCommits?: number;
        output?: string;
        allowLargePlan?: boolean;
        allowFuture?: boolean;
      }) => {
        if (
          !options.project ||
          !options.repo ||
          !options.authorName ||
          !options.authorEmail
        ) {
          throw new GitMosaicError(
            "INVALID_PROJECT",
            "Missing required plan options",
            {
              hint: "Provide --project, --repo, --author-name, and --author-email",
            },
          );
        }
        const projectDirectory = path.resolve(options.project);
        const project = await readProject(projectDirectory);
        const planningProject =
          options.levels === undefined
            ? project
            : { ...project, commitLevelMap: options.levels };
        const hasCommitter =
          options.committerName !== undefined &&
          options.committerEmail !== undefined;
        const plan = createCommitPlan({
          project: planningProject,
          repository: {
            path: path.resolve(options.repo),
            branch: options.branch,
            mode: options.repositoryMode,
            ...(options.expectedHead === undefined
              ? {}
              : { expectedHead: options.expectedHead }),
          },
          author: { name: options.authorName, email: options.authorEmail },
          ...(hasCommitter
            ? {
                committer: {
                  name: options.committerName!,
                  email: options.committerEmail!,
                },
              }
            : {}),
          commitMode: options.commitMode,
          ...(options.filePath === undefined
            ? {}
            : { filePath: options.filePath }),
          ...(options.messageTemplate === undefined
            ? {}
            : { messageTemplate: options.messageTemplate }),
          ...(options.maxCommitsPerDay === undefined
            ? {}
            : { maximumCommitsPerDay: options.maxCommitsPerDay }),
          ...(options.maxTotalCommits === undefined
            ? {}
            : { maximumTotalCommits: options.maxTotalCommits }),
          allowLargePlan: options.allowLargePlan ?? false,
          allowFuture: options.allowFuture ?? false,
        });
        const output = path.resolve(
          options.output ?? path.join(projectDirectory, "plans", "latest.json"),
        );
        await writeCommitPlan(output, plan);
        writeOutput(
          program,
          `Plan ${plan.planId}: ${plan.totals.days} active days, ${plan.totals.commits} commits\nWrote ${output}\n`,
        );
      },
    );
  planCommand
    .command("inspect")
    .description("validate and summarize a commit plan")
    .argument("<file>", "commit plan JSON")
    .action(async (file: string) => {
      const plan = await readCommitPlan(path.resolve(file));
      writeOutput(
        program,
        `Plan: ${plan.planId}\nProject: ${plan.projectName}\nRepository: ${plan.repository.path}\nBranch: ${plan.repository.branch}\nActive days: ${plan.totals.days}\nCommits: ${plan.totals.commits}\nChecksum: ${plan.checksum}\n`,
      );
    });

  program
    .command("apply")
    .description("validate or materialize a commit plan")
    .argument("<file>", "commit plan JSON")
    .option("--dry-run", "validate and summarize without writing")
    .option("--init-repository", "authorize creation of a new repository")
    .option("--allow-existing-repository", "authorize an existing repository")
    .option(
      "--allow-repository-with-remotes",
      "authorize a repository that has remotes",
    )
    .option("--yes", "confirm non-interactively after reviewing dry-run")
    .action(
      async (
        file: string,
        options: {
          dryRun?: boolean;
          initRepository?: boolean;
          allowExistingRepository?: boolean;
          allowRepositoryWithRemotes?: boolean;
          yes?: boolean;
        },
      ) => {
        const planPath = path.resolve(file);
        const plan = await readCommitPlan(planPath);
        const dryRun = options.dryRun ?? false;
        if (
          !dryRun &&
          plan.repository.mode === "new" &&
          !options.initRepository
        ) {
          throw new GitMosaicError(
            "EXISTING_REPOSITORY_NOT_ALLOWED",
            "New repository creation requires explicit authorization",
            {
              hint: "Run --dry-run first, then add --init-repository",
            },
          );
        }
        const confirmed = dryRun
          ? false
          : (options.yes ?? false) ||
            (await confirmApplication(plan.planId, plan.repository.path));
        if (!dryRun && !confirmed) {
          throw new GitMosaicError(
            "EXISTING_REPOSITORY_NOT_ALLOWED",
            "Commit materialization was not confirmed",
          );
        }

        const controller = new AbortController();
        const interrupt = () => controller.abort();
        process.once("SIGINT", interrupt);
        try {
          const result = await applyCommitPlan(plan, {
            dryRun,
            confirmed,
            allowExistingRepository: options.allowExistingRepository ?? false,
            allowRepositoryWithRemotes:
              options.allowRepositoryWithRemotes ?? false,
            signal: controller.signal,
          });
          writeOutput(
            program,
            `Project: ${plan.projectName}\nRepository: ${result.repositoryPath}\nBranch: ${result.branch}\nRemotes: ${result.remotes.length === 0 ? "none" : result.remotes.join(", ")}\nState: ${result.status}\nApplied: ${result.appliedSteps}/${result.totalSteps}\nCreated now: ${result.createdCommits}\nNo Git push was executed.\n`,
          );
          if (result.status === "partial") {
            const reportPath = `${planPath}.apply-report.json`;
            await writePreview(
              reportPath,
              `${JSON.stringify({ planId: plan.planId, interruptedAt: new Date().toISOString(), ...result }, null, 2)}\n`,
            );
            writeOutput(
              program,
              `Partial report: ${reportPath}\nRun apply again to resume.\n`,
            );
          }
        } finally {
          process.removeListener("SIGINT", interrupt);
        }
      },
    );
  const githubCommand = program
    .command("github")
    .description("import observed contribution data from GitHub");
  githubCommand
    .command("import")
    .description("import a contribution calendar snapshot")
    .requiredOption("--username <login>", "GitHub username")
    .requiredOption("--project <path>", "mosaic project directory")
    .option(
      "--token-stdin",
      "read the GitHub token from stdin instead of GITHUB_TOKEN",
    )
    .action(
      async (options: {
        username: string;
        project: string;
        tokenStdin?: boolean;
      }) => {
        const token = options.tokenStdin
          ? await readStandardInput()
          : process.env.GITHUB_TOKEN;
        if (!token) {
          throw new GitMosaicError(
            "GITHUB_AUTH_FAILED",
            "GitHub token is missing",
            {
              hint: "Set GITHUB_TOKEN or pass --token-stdin; tokens are never persisted",
            },
          );
        }
        const project = await importGitHubContributions(
          path.resolve(options.project),
          options.username,
          new GitHubGraphQLProvider({ token }),
        );
        writeOutput(
          program,
          `Imported ${project.existingContributions?.days.length ?? 0} observed days for ${options.username}\nSnapshot can now be used offline.\n`,
        );
      },
    );

  return program;
}
