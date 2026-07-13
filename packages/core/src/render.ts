import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ArtisticIntensityStrategy,
  QuartileApproximationStrategy,
  type ContributionLevelStrategy,
} from "@git-mosaic/calendar";
import {
  renderSvg,
  renderTerminal,
  type SvgRenderOptions,
  type TerminalRenderOptions,
} from "@git-mosaic/renderer";
import { readProject } from "./project.js";
import { buildPreviewCalendar } from "./preview.js";

export type PreviewMode = "artistic" | "estimate";

function strategyFor(mode: PreviewMode): ContributionLevelStrategy {
  return mode === "estimate"
    ? new QuartileApproximationStrategy()
    : new ArtisticIntensityStrategy();
}

export async function renderProjectTerminal(
  projectDirectory: string,
  options: TerminalRenderOptions = {},
  mode: PreviewMode = "artistic",
): Promise<string> {
  const project = await readProject(projectDirectory);
  return renderTerminal(
    buildPreviewCalendar(project, strategyFor(mode)),
    options,
  ).content;
}

export async function renderProjectSvg(
  projectDirectory: string,
  options: SvgRenderOptions = {},
  mode: PreviewMode = "artistic",
): Promise<string> {
  const project = await readProject(projectDirectory);
  return renderSvg(buildPreviewCalendar(project, strategyFor(mode)), options);
}

export async function writePreview(
  filePath: string,
  content: string,
): Promise<void> {
  const target = path.resolve(filePath);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
}
