import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cliVersion, createProgram } from "./program.js";

const temporaryDirectories: string[] = [];

async function cliProject(year: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "git-mosaic-fit-"));
  temporaryDirectories.push(root);
  const target = path.join(root, "fit-project");
  await createProgram().parseAsync([
    "node",
    "git-mosaic",
    "init",
    "fit-project",
    "--directory",
    target,
    "--year",
    year,
    "--timezone",
    "UTC",
  ]);
  return target;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe("CLI contract", () => {
  it("exposes its version and planned command groups without side effects", () => {
    const program = createProgram();
    const help = program.helpInformation();

    expect(program.version()).toBe(cliVersion);
    for (const command of [
      "init",
      "import",
      "preview",
      "plan",
      "apply",
      "github",
    ]) {
      expect(help).toContain(command);
    }
    const importHelp = program.commands
      .find((command) => command.name() === "import")
      ?.helpInformation();
    expect(importHelp).toContain("matrix");
    expect(importHelp).toContain("text");
    expect(importHelp).not.toContain("image");
  });

  it("initializes a project from the command line", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "git-mosaic-cli-"));
    temporaryDirectories.push(root);
    const target = path.join(root, "cli-project");
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "init",
      "cli-project",
      "--directory",
      target,
      "--year",
      "2026",
      "--timezone",
      "UTC",
    ]);

    const project = JSON.parse(
      await readFile(path.join(target, "mosaic.json"), "utf8"),
    ) as {
      name: string;
      period: { from: string; to: string };
    };
    expect(project).toMatchObject({
      name: "cli-project",
      period: { from: "2026-01-01", to: "2026-12-31" },
    });

    const completeProject = JSON.parse(
      await readFile(path.join(target, "mosaic.json"), "utf8"),
    ) as { dimensions: { columns: number } };
    const matrix = Array.from({ length: 7 }, () =>
      Array<number>(completeProject.dimensions.columns).fill(0),
    );
    matrix[4]![0] = 1;
    const matrixPath = path.join(root, "matrix.json");
    await writeFile(matrixPath, JSON.stringify(matrix));
    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "import",
      "matrix",
      matrixPath,
      "--project",
      target,
    ]);
    const imported = JSON.parse(
      await readFile(path.join(target, "mosaic.json"), "utf8"),
    ) as { source: { type: string; path?: string } };
    expect(imported.source).toMatchObject({
      type: "matrix",
      path: "../matrix.json",
    });

    stdout.mockClear();
    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "preview",
      "--project",
      target,
      "--no-color",
    ]);
    expect(stdout.mock.calls.map((call) => String(call[0])).join("")).toContain(
      "Warning: GitHub may render different contribution levels and colors.",
    );

    const svgPath = path.join(target, "exports", "preview.svg");
    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "preview",
      "--project",
      target,
      "--output",
      svgPath,
      "--theme",
      "light",
    ]);
    const artisticSvg = await readFile(svgPath, "utf8");
    expect(artisticSvg).toContain("<svg");
    expect(artisticSvg).toContain(
      'data-date="2026-01-01" data-state="in-range" data-level="1"',
    );

    const estimateSvgPath = path.join(
      target,
      "exports",
      "preview-estimate.svg",
    );
    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "preview",
      "--project",
      target,
      "--output",
      estimateSvgPath,
      "--estimate",
    ]);
    expect(await readFile(estimateSvgPath, "utf8")).toContain(
      'data-date="2026-01-01" data-state="in-range" data-level="4"',
    );

    const planPath = path.join(target, "plans", "cli-plan.json");
    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "plan",
      "--project",
      target,
      "--repo",
      path.join(root, "repository"),
      "--author-name",
      "CLI Test",
      "--author-email",
      "cli@example.com",
      "--levels",
      "0,2,4,10,20",
      "--output",
      planPath,
    ]);
    const plan = JSON.parse(await readFile(planPath, "utf8")) as {
      totals: { days: number; commits: number };
      checksum: string;
    };
    expect(plan.totals).toMatchObject({ days: 1, commits: 2 });
    expect(plan.checksum).toMatch(/^[a-f0-9]{64}$/);

    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "plan",
      "inspect",
      planPath,
    ]);

    const repositoryPath = path.join(root, "repository");
    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "apply",
      planPath,
      "--dry-run",
    ]);
    await expect(
      readFile(path.join(repositoryPath, ".git", "HEAD")),
    ).rejects.toThrow();
    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "apply",
      planPath,
      "--init-repository",
      "--yes",
    ]);
    expect(
      await readFile(path.join(repositoryPath, ".git", "HEAD"), "utf8"),
    ).toContain("refs/heads/main");

    stdout.mockClear();
    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "--quiet",
      "preview",
      "--project",
      target,
    ]);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("imports a GitHub snapshot without persisting its token", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "git-mosaic-cli-github-"));
    temporaryDirectories.push(root);
    const target = path.join(root, "project");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "init",
      "github-project",
      "--directory",
      target,
      "--from",
      "2026-01-04",
      "--to",
      "2026-01-10",
      "--timezone",
      "UTC",
    ]);
    vi.stubEnv("GITHUB_TOKEN", "cli-secret-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                user: {
                  contributionsCollection: {
                    contributionCalendar: {
                      weeks: [
                        {
                          contributionDays: [
                            {
                              date: "2026-01-04",
                              contributionCount: 2,
                              contributionLevel: "SECOND_QUARTILE",
                              color: "#40c463",
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "github",
      "import",
      "--username",
      "octocat",
      "--project",
      target,
    ]);

    const projectText = await readFile(
      path.join(target, "mosaic.json"),
      "utf8",
    );
    const snapshotText = await readFile(
      path.join(target, "snapshot.github.json"),
      "utf8",
    );
    expect(projectText).toContain("SECOND_QUARTILE");
    expect(snapshotText).toContain("octocat");
    expect(`${projectText}${snapshotText}`).not.toContain("cli-secret-token");
  });
});

describe("import text", () => {
  it("imports text, prints the fit report, and previews it", async () => {
    const target = await cliProject("2025");
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "import",
      "text",
      "Loading...",
      "--project",
      target,
    ]);

    const output = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("Imported text into fit-project");
    expect(output).toContain("Fit: GOOD");
    expect(output).toContain("Legend:");

    const project = JSON.parse(
      await readFile(path.join(target, "mosaic.json"), "utf8"),
    ) as { source: Record<string, unknown> };
    expect(project.source).toEqual({
      type: "text",
      content: "Loading...",
      font: "5x7",
      align: "center",
    });
  });

  it("refuses text that cannot fit at the smallest legible font", async () => {
    const target = await cliProject("2025");
    await expect(
      createProgram().parseAsync([
        "node",
        "git-mosaic",
        "import",
        "text",
        "lorem ipsum dolor".repeat(5),
        "--project",
        target,
      ]),
    ).rejects.toMatchObject({ code: "GM016" });

    const project = JSON.parse(
      await readFile(path.join(target, "mosaic.json"), "utf8"),
    ) as { source: { type: string } };
    expect(project.source.type).toBe("empty");
  });
});
