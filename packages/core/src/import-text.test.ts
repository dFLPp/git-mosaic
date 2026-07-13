import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { importText, initializeProject, readProject } from "./project.js";

async function projectDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "gm-text-"));
  await initializeProject(directory, {
    name: "text-test",
    period: { from: "2025-01-01", to: "2025-12-31" },
    timezone: "UTC",
  });
  return directory;
}

describe("importText", () => {
  it("stamps text, persists the source, and returns a report", async () => {
    const directory = await projectDirectory();
    const { project, report } = await importText(directory, "Loading...");
    expect(project.source).toEqual({
      type: "text",
      content: "Loading...",
      font: "5x7",
      align: "center",
    });
    expect(report.signals.fontTier).toBe("5x7");
    expect(new Set(project.intensityMap.flat())).toEqual(new Set([0, 4]));
    const reloaded = await readProject(directory);
    expect(reloaded.source).toEqual(project.source);
  });

  it("propagates TEXT_DOES_NOT_FIT without modifying the project", async () => {
    const directory = await projectDirectory();
    await expect(
      importText(directory, "lorem ipsum dolor".repeat(5)),
    ).rejects.toMatchObject({ code: "GM016" });
    const reloaded = await readProject(directory);
    expect(reloaded.source.type).toBe("empty");
  });

  it("honors alignment", async () => {
    const directory = await projectDirectory();
    const { project } = await importText(directory, "HI", { align: "left" });
    expect(project.intensityMap[0]?.[1]).toBe(4);
  });
});
