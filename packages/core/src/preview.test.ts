import { describe, expect, it } from "vitest";
import { createProject } from "./project.js";
import { buildPreviewCalendar } from "./preview.js";

describe("buildPreviewCalendar", () => {
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
