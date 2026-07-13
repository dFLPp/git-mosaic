import {
  applyIntensityMap,
  ArtisticIntensityStrategy,
  buildCalendar,
  type ContributionCalendar,
  type ContributionLevelStrategy,
} from "@git-mosaic/calendar";
import type { MosaicProject } from "@git-mosaic/schemas";

export function buildPreviewCalendar(
  project: MosaicProject,
  strategy: ContributionLevelStrategy = new ArtisticIntensityStrategy(),
): ContributionCalendar {
  const calendar = applyIntensityMap(
    buildCalendar(project.period, project.timezone),
    project.intensityMap,
  );
  const observedByDate = new Map(
    project.existingContributions?.days.map((day) => [day.date, day]),
  );
  const countedCells = calendar.cells.flat().map((cell) => {
    const observed = observedByDate.get(cell.date);
    const plannedCount = cell.inRange
      ? project.commitLevelMap[cell.intensity]
      : 0;
    const existingCount = observed?.contributionCount ?? 0;
    return {
      ...cell,
      existingCount,
      plannedCount,
      finalCount: existingCount + plannedCount,
      confidence:
        observed === undefined
          ? ("ESTIMATED" as const)
          : plannedCount > 0
            ? ("MIXED" as const)
            : ("OBSERVED" as const),
      ...(observed?.color === undefined ? {} : { color: observed.color }),
    };
  });
  const classified = strategy.calculate(countedCells);
  const finalCells = classified.map((cell) => {
    const observed = observedByDate.get(cell.date);
    return cell.confidence === "OBSERVED" && observed !== undefined
      ? {
          ...cell,
          level: observed.contributionLevel,
          ...(observed.color === undefined ? {} : { color: observed.color }),
        }
      : cell;
  });

  return {
    ...calendar,
    cells: Array.from({ length: 7 }, (_, row) =>
      finalCells.filter((cell) => cell.row === row),
    ),
  };
}
