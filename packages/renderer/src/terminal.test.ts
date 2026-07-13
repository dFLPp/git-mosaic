import { buildCalendar, type CalendarCell } from "@git-mosaic/calendar";
import { describe, expect, it } from "vitest";

import { renderTerminal, TerminalRenderer } from "./terminal.js";

function exampleCalendar() {
  const calendar = buildCalendar(
    { from: "2026-01-01", to: "2026-01-10" },
    "UTC",
  );
  const levels: CalendarCell["level"][] = [
    "NONE",
    "FIRST_QUARTILE",
    "SECOND_QUARTILE",
    "THIRD_QUARTILE",
    "FOURTH_QUARTILE",
  ];
  calendar.cells
    .flat()
    .filter((cell) => cell.inRange)
    .forEach((cell, index) => {
      cell.level = levels[index % levels.length] ?? "NONE";
      cell.confidence = index === 0 ? "OBSERVED" : "ESTIMATED";
    });
  return calendar;
}

describe("renderTerminal", () => {
  it("renders deterministic labels, distinct monochrome levels and the estimate warning", () => {
    const calendar = exampleCalendar();
    const first = renderTerminal(calendar).content;
    const second = new TerminalRenderer(calendar).render().content;

    expect(first).toBe(second);
    expect(first).toMatchInlineSnapshot(`
      "    Jan
      Sun × ·
      Mon × ░
      Tue × ▒
      Wed × ▓
      Thu █ ·
      Fri ░ ▒
      Sat ▓ █
      Legend: × out of range  · none  ░ level 1  ▒ level 2  ▓ level 3  █ level 4
      Confidence: MIXED
      Warning: GitHub contribution levels and colors are estimates.
      "
    `);
    expect(new Set(["·", "░", "▒", "▓", "█", "×"]).size).toBe(6);
  });

  it("supports ANSI without relying on color to distinguish cells", () => {
    const plain = renderTerminal(exampleCalendar(), {
      color: false,
      showMonths: false,
      showWeekdays: false,
      showLegend: false,
    }).content;
    const ansi = renderTerminal(exampleCalendar(), {
      color: true,
      showMonths: false,
      showWeekdays: false,
      showLegend: false,
      theme: "light",
    }).content;

    expect(ansi).toContain("\u001B[");
    expect(ansi.replaceAll(/\u001B\[[0-9;]*m/g, "")).toBe(plain);
    expect(plain).toContain(
      "Warning: GitHub contribution levels and colors are estimates.",
    );
  });

  it("allows month, weekday and legend labels to be configured", () => {
    const result = renderTerminal(exampleCalendar(), {
      monthLabels: [
        "J1",
        "F2",
        "M3",
        "A4",
        "M5",
        "J6",
        "J7",
        "A8",
        "S9",
        "O10",
        "N11",
        "D12",
      ],
      weekdayLabels: ["D", "S", "T", "Q", "Q", "S", "S"],
      legendLabels: { NONE: "zero", OUT_OF_RANGE: "outside" },
    }).content;

    expect(result).toContain(" J1");
    expect(result).toContain("D × ·");
    expect(result).toContain("× outside  · zero");
  });

  it("keeps the warning while optional decorations are hidden", () => {
    const result = renderTerminal(exampleCalendar(), {
      showMonths: false,
      showWeekdays: false,
      showLegend: false,
    }).content;

    expect(result).not.toContain("Jan");
    expect(result).not.toContain("Legend:");
    expect(result).toMatch(/^× ·/);
    expect(result).toMatch(
      /Warning: GitHub contribution levels and colors are estimates\.\n$/,
    );
  });

  it("rejects incomplete custom label sets", () => {
    expect(() =>
      renderTerminal(exampleCalendar(), { weekdayLabels: ["Sun"] }),
    ).toThrow(/exactly 7/);
    expect(() =>
      renderTerminal(exampleCalendar(), { monthLabels: ["Jan"] }),
    ).toThrow(/exactly 12/);
  });
});
