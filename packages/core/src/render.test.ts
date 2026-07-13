import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeProject, writeProject } from "./project.js";
import { renderProjectSvg, renderProjectTerminal } from "./render.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe("project preview rendering", () => {
  it("renders deterministic terminal and SVG previews without Git", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "git-mosaic-render-"));
    directories.push(root);
    const project = await initializeProject(root, {
      name: "render",
      period: { from: "2026-01-04", to: "2026-01-10" },
      timezone: "UTC",
      now: "2026-01-01T00:00:00.000Z",
    });
    project.intensityMap[0]![0] = 4;
    await writeProject(root, project);

    const terminal = await renderProjectTerminal(root, { color: false });
    const firstSvg = await renderProjectSvg(root, { theme: "light" });
    const secondSvg = await renderProjectSvg(root, { theme: "light" });
    expect(terminal).toContain(
      "Warning: GitHub contribution levels and colors are estimates.",
    );
    expect(terminal).toContain("█");
    expect(firstSvg).toBe(secondSvg);
    expect(firstSvg).toContain("<svg");
  });
});
