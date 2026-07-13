import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  renderSvg,
  renderTerminal,
  type SvgRenderOptions,
  type TerminalRenderOptions,
} from "@git-mosaic/renderer";
import { readProject } from "./project.js";
import { buildPreviewCalendar } from "./preview.js";

export async function renderProjectTerminal(
  projectDirectory: string,
  options: TerminalRenderOptions = {},
): Promise<string> {
  const project = await readProject(projectDirectory);
  return renderTerminal(buildPreviewCalendar(project), options).content;
}

export async function renderProjectSvg(
  projectDirectory: string,
  options: SvgRenderOptions = {},
): Promise<string> {
  const project = await readProject(projectDirectory);
  return renderSvg(buildPreviewCalendar(project), options);
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
