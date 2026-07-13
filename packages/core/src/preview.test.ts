import { describe, expect, it } from "vitest";
import { createProject } from "./project.js";
import { buildPreviewCalendar } from "./preview.js";

describe("buildPreviewCalendar", () => {
  it("maps drawn intensities directly by default regardless of commit counts", () => {
    const project = createProject({
      name: "artistic-preview",
      period: { from: "2026-01-04", to: "2026-01-10" },
      timezone: "UTC",
      now: "2026-01-01T00:00:00.000Z",
    });
    project.intensityMap[0]![0] = 1;
    project.intensityMap[1]![0] = 2;
    project.intensityMap[2]![0] = 3;
    project.intensityMap[3]![0] = 4;
    project.commitLevelMap = { 0: 0, 1: 100, 2: 1, 3: 50, 4: 2 };

    const preview = buildPreviewCalendar(project);

    expect(preview.cells.slice(0, 4).map((row) => row[0]?.level)).toEqual([
      "FIRST_QUARTILE",
      "SECOND_QUARTILE",
      "THIRD_QUARTILE",
      "FOURTH_QUARTILE",
    ]);
  });

  it("combines planned and observed counts while preserving observed levels", () => {
    const project = createProject({
      name: "preview",
      period: { from: "2026-01-04", to: "2026-01-10" },
      timezone: "UTC",
      now: "2026-01-01T00:00:00.000Z",
    });
    project.intensityMap[0]![0] = 1;
    project.existingContributions = {
      schemaVersion: 1,
      username: "octocat",
      period: project.period,
      fetchedAt: "2026-01-01T00:00:00.000Z",
      days: [
        {
          date: "2026-01-04",
          contributionCount: 2,
          contributionLevel: "FIRST_QUARTILE",
          color: "#123456",
        },
        {
          date: "2026-01-05",
          contributionCount: 3,
          contributionLevel: "THIRD_QUARTILE",
          color: "#abcdef",
        },
      ],
    };

    const preview = buildPreviewCalendar(project);
    expect(preview.cells[0]?.[0]).toMatchObject({
      existingCount: 2,
      plannedCount: 1,
      finalCount: 3,
      confidence: "MIXED",
    });
    expect(preview.cells[1]?.[0]).toMatchObject({
      finalCount: 3,
      confidence: "OBSERVED",
      level: "THIRD_QUARTILE",
      color: "#abcdef",
    });
  });
});
