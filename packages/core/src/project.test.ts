import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importMatrix, initializeProject, readProject } from "./project.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "git-mosaic-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("mosaic projects", () => {
  it("initializes the documented directory structure and round-trips mosaic.json", async () => {
    const root = await temporaryDirectory();
    const projectDirectory = path.join(root, "sample");
    const created = await initializeProject(projectDirectory, {
      name: "sample",
      period: { from: "2026-01-01", to: "2026-12-31" },
      timezone: "UTC",
      now: "2026-07-12T12:00:00.000Z",
    });

    expect(await readProject(projectDirectory)).toEqual(created);
    expect(
      JSON.parse(
        await readFile(path.join(projectDirectory, "mosaic.json"), "utf8"),
      ),
    ).toEqual(created);
    await expect(
      initializeProject(projectDirectory, {
        name: "again",
        period: created.period,
        timezone: "UTC",
      }),
    ).rejects.toThrow(/GM001|already exists/);

    const nonEmpty = path.join(root, "non-empty");
    await mkdir(nonEmpty);
    await writeFile(path.join(nonEmpty, "marker.txt"), "not empty");
    await expect(
      initializeProject(nonEmpty, {
        name: "invalid",
        period: created.period,
        timezone: "UTC",
      }),
    ).rejects.toThrow();
  });

  it("imports a valid matrix atomically and preserves the project on failure", async () => {
    const root = await temporaryDirectory();
    const projectDirectory = path.join(root, "sample");
    const project = await initializeProject(projectDirectory, {
      name: "sample",
      period: { from: "2026-01-04", to: "2026-01-10" },
      timezone: "UTC",
      now: "2026-01-01T00:00:00.000Z",
    });
    const validMatrix = Array.from({ length: 7 }, () => [0]);
    validMatrix[1]![0] = 4;
    const matrixPath = path.join(root, "matrix.json");
    await writeFile(matrixPath, JSON.stringify(validMatrix));
    const updated = await importMatrix(
      projectDirectory,
      matrixPath,
      "2026-01-02T00:00:00.000Z",
    );
    expect(updated.intensityMap[1]?.[0]).toBe(4);

    await writeFile(matrixPath, "[[9]]");
    await expect(importMatrix(projectDirectory, matrixPath)).rejects.toThrow(
      /GM004|Invalid matrix/,
    );
    expect((await readProject(projectDirectory)).intensityMap).toEqual(
      updated.intensityMap,
    );
    expect(project.dimensions.columns).toBe(1);
  });
});
