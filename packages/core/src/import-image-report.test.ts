import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { importImageBuffer, initializeProject } from "./project.js";

async function projectDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "gm-fit-"));
  await initializeProject(directory, {
    name: "fit-test",
    period: { from: "2023-01-01", to: "2023-12-30" },
    timezone: "UTC",
  });
  return directory;
}

async function silhouettePng(): Promise<Buffer> {
  const width = 520;
  const height = 70;
  const pixels = new Uint8Array(width * height).fill(255);
  for (let y = 10; y < 60; y += 1) {
    pixels.fill(0, y * width + 100, y * width + 420);
  }
  return sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

async function noisePng(): Promise<Buffer> {
  const width = 520;
  const height = 70;
  const pixels = new Uint8Array(width * height);
  let state = 42;
  for (let index = 0; index < pixels.length; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    pixels[index] = state % 2 === 0 ? 0 : 255;
  }
  return sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

describe("importImageBuffer fit gate", () => {
  it("returns the project and a fit report for good art", async () => {
    const directory = await projectDirectory();
    const { project, report } = await importImageBuffer(
      directory,
      "art.png",
      await silhouettePng(),
    );
    expect(project.source.type).toBe("image");
    expect(report.verdict).toBe("good");
    if (project.source.type === "image") {
      expect(project.source.normalize).toBe(true);
      expect(project.source.mode).toBe("levels");
    }
  });

  it("refuses bad art without force and writes nothing", async () => {
    const directory = await projectDirectory();
    await expect(
      importImageBuffer(directory, "noise.png", await noisePng()),
    ).rejects.toMatchObject({ code: "GM018" });
    const stored = JSON.parse(
      await readFile(path.join(directory, "mosaic.json"), "utf8"),
    ) as { source: { type: string } };
    expect(stored.source.type).not.toBe("image");
    expect(await readdir(path.join(directory, "assets"))).toEqual([]);
  });

  it("imports bad art with force: true", async () => {
    const directory = await projectDirectory();
    const { report } = await importImageBuffer(
      directory,
      "noise.png",
      await noisePng(),
      { force: true },
    );
    expect(report.verdict).toBe("bad");
  });
});
