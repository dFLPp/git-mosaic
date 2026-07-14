import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  buildCalendar,
  createEmptyIntensityMap,
  validateIntensityMap,
} from "@git-mosaic/calendar";
import {
  intensityMapSchema,
  mosaicProjectSchema,
  type DateRange,
  type FitReport,
  type IntensityMap,
  type MosaicProject,
} from "@git-mosaic/schemas";
import { stampTextOnCalendar, type TextAlign } from "@git-mosaic/text";
import { GitMosaicError } from "./errors.js";

export const projectFileName = "mosaic.json";

function validateProjectSemantics(project: MosaicProject): void {
  const calendar = buildCalendar(project.period, project.timezone);
  if (
    project.dimensions.rows !== 7 ||
    project.dimensions.columns !== calendar.columns
  ) {
    throw new GitMosaicError(
      "INVALID_PROJECT",
      "Project dimensions do not match its period",
      {
        hint: `Expected 7 rows and ${calendar.columns} columns`,
      },
    );
  }
  validateIntensityMap(project.intensityMap, calendar);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function createProject(input: {
  name: string;
  period: DateRange;
  timezone: string;
  now?: string;
}): MosaicProject {
  const calendar = buildCalendar(input.period, input.timezone);
  const now = input.now ?? new Date().toISOString();
  return mosaicProjectSchema.parse({
    schemaVersion: 1,
    name: input.name,
    createdAt: now,
    updatedAt: now,
    period: input.period,
    timezone: input.timezone,
    weekStartsOn: 0,
    dimensions: { rows: 7, columns: calendar.columns },
    source: { type: "empty" },
    intensityMap: createEmptyIntensityMap(calendar.columns),
    commitLevelMap: { 0: 0, 1: 1, 2: 4, 3: 10, 4: 20 },
  });
}

export async function writeProject(
  projectDirectory: string,
  project: MosaicProject,
): Promise<void> {
  const parsed = mosaicProjectSchema.safeParse(project);
  if (!parsed.success) {
    throw new GitMosaicError(
      "INVALID_PROJECT",
      "Cannot write an invalid mosaic project",
      {
        hint: parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
        cause: parsed.error,
      },
    );
  }
  validateProjectSemantics(parsed.data);
  const target = path.join(projectDirectory, projectFileName);
  const temporary = `${target}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify(parsed.data, null, 2)}\n`,
    "utf8",
  );
  await rename(temporary, target);
}

export async function initializeProject(
  projectDirectory: string,
  input: { name: string; period: DateRange; timezone: string; now?: string },
): Promise<MosaicProject> {
  const target = path.resolve(projectDirectory);
  if (await pathExists(path.join(target, projectFileName))) {
    throw new GitMosaicError(
      "INVALID_PROJECT",
      `A mosaic project already exists at ${target}`,
      {
        hint: "Choose an empty directory or open the existing project",
      },
    );
  }
  if (await pathExists(target)) {
    const entries = await readdir(target);
    if (entries.length > 0) {
      throw new GitMosaicError(
        "INVALID_PROJECT",
        `Project directory is not empty: ${target}`,
        { hint: "Choose a new or empty directory" },
      );
    }
  }
  await mkdir(path.join(target, "exports"), { recursive: true });
  await mkdir(path.join(target, "plans"), { recursive: true });
  const project = createProject(input);
  await writeProject(target, project);
  return project;
}

export async function readProject(
  projectDirectory: string,
): Promise<MosaicProject> {
  const target = path.join(path.resolve(projectDirectory), projectFileName);
  try {
    const contents = await readFile(target, "utf8");
    const parsed = mosaicProjectSchema.safeParse(
      JSON.parse(contents) as unknown,
    );
    if (!parsed.success) {
      throw new GitMosaicError(
        "INVALID_PROJECT",
        `Invalid project file: ${target}`,
        {
          hint: parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
          cause: parsed.error,
        },
      );
    }
    validateProjectSemantics(parsed.data);
    return parsed.data;
  } catch (cause) {
    if (cause instanceof GitMosaicError) throw cause;
    throw new GitMosaicError(
      "INVALID_PROJECT",
      `Could not read project file: ${target}`,
      {
        hint: "Verify that mosaic.json exists and contains valid JSON",
        cause,
      },
    );
  }
}

export async function importMatrix(
  projectDirectory: string,
  matrixFile: string,
  now = new Date().toISOString(),
): Promise<MosaicProject> {
  const project = await readProject(projectDirectory);
  let matrix: IntensityMap;
  try {
    matrix = intensityMapSchema.parse(
      JSON.parse(await readFile(matrixFile, "utf8")) as unknown,
    );
  } catch (cause) {
    throw new GitMosaicError(
      "INVALID_INTENSITY_MAP",
      `Invalid matrix file: ${matrixFile}`,
      {
        hint: "Provide a JSON array with seven rows and intensity values from 0 through 4",
        cause,
      },
    );
  }
  const calendar = buildCalendar(project.period, project.timezone);
  validateIntensityMap(matrix, calendar);
  const updated = mosaicProjectSchema.parse({
    ...project,
    updatedAt: now,
    source: {
      type: "matrix",
      path: path.relative(
        path.resolve(projectDirectory),
        path.resolve(matrixFile),
      ),
    },
    intensityMap: matrix,
  });
  await writeProject(projectDirectory, updated);
  return updated;
}

export async function importText(
  projectDirectory: string,
  content: string,
  options: { align?: TextAlign } = {},
  now = new Date().toISOString(),
): Promise<{ project: MosaicProject; report: FitReport }> {
  const project = await readProject(projectDirectory);
  const calendar = buildCalendar(project.period, project.timezone);
  const { map, report, tier } = stampTextOnCalendar(content, calendar, options);
  const updated = mosaicProjectSchema.parse({
    ...project,
    updatedAt: now,
    source: {
      type: "text",
      content,
      font: tier,
      align: options.align ?? "center",
    },
    intensityMap: map,
  });
  await writeProject(projectDirectory, updated);
  return { project: updated, report };
}
