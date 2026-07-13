import { describe, expect, it } from "vitest";
import { buildCalendar, type ContributionCalendar } from "@git-mosaic/calendar";
import { renderSvg, SvgRenderer } from "./svg.js";

function sampleCalendar(): ContributionCalendar {
  const calendar = buildCalendar(
    { from: "2026-01-01", to: "2026-02-03" },
    "UTC",
  );
  const first = calendar.cells[4]?.[0];
  const observed = calendar.cells[0]?.[1];
  if (first !== undefined) {
    Object.assign(first, {
      finalCount: 1,
      plannedCount: 1,
      level: "FIRST_QUARTILE",
      confidence: "ESTIMATED",
    });
  }
  if (observed !== undefined) {
    Object.assign(observed, {
      finalCount: 20,
      existingCount: 20,
      level: "FOURTH_QUARTILE",
      confidence: "OBSERVED",
      color: "#123456",
    });
  }
  return calendar;
}

describe("renderSvg", () => {
  it("renders a deterministic, labelled light calendar", () => {
    const calendar = sampleCalendar();
    const first = renderSvg(calendar);
    const second = renderSvg(calendar);

    expect(first).toBe(second);
    expect(first).toContain('width="133" height="151"');
    expect(first).toContain('<text x="36" y="12">Jan</text>');
    expect(first).toContain('<text x="106" y="12">Feb</text>');
    expect(first).toContain('<text x="0" y="32">Sun</text>');
    expect(first).toContain(
      'data-date="2025-12-28" data-state="out-of-range" data-level="-1"',
    );
    expect(first).toContain(
      'data-date="2026-01-01" data-state="in-range" data-level="1"',
    );
    expect(first).toContain("2026-01-01: 1 contribution, level 1, estimated");
    expect(first).toContain('class="legend"');
    expect(new SvgRenderer(calendar).render().mediaType).toBe("image/svg+xml");
  });

  it("supports a dark compact rendering with custom geometry and no tooltips", () => {
    const svg = renderSvg(sampleCalendar(), {
      theme: "dark",
      cellSize: 8,
      cellGap: 2,
      showMonths: false,
      showWeekdays: false,
      showLegend: false,
      tooltips: false,
    });

    expect(svg).toContain('width="58" height="68"');
    expect(svg).toContain('fill="#0d1117"');
    expect(svg).toContain('rx="2"');
    expect(svg).not.toContain('class="month-labels"');
    expect(svg).not.toContain('class="weekday-labels"');
    expect(svg).not.toContain('class="legend"');
    expect(svg).not.toContain("<title>2026-");
  });

  it("escapes externally supplied colors and validates geometry", () => {
    const calendar = sampleCalendar();
    const cell = calendar.cells[0]?.[1];
    if (cell !== undefined) cell.color = "&quot<unsafe>";

    expect(renderSvg(calendar)).toContain('fill="&amp;quot&lt;unsafe&gt;"');
    expect(() => renderSvg(calendar, { cellSize: 0 })).toThrow(/cellSize/);
    expect(() => renderSvg(calendar, { cellGap: -1 })).toThrow(/cellGap/);
  });

  it("has a stable compact snapshot", () => {
    const calendar = buildCalendar(
      { from: "2026-01-04", to: "2026-01-04" },
      "UTC",
    );

    expect(
      renderSvg(calendar, {
        cellSize: 2,
        cellGap: 0,
        showMonths: false,
        showWeekdays: false,
        showLegend: false,
        tooltips: false,
      }),
    ).toMatchInlineSnapshot(`
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
      <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2\" height=\"14\" viewBox=\"0 0 2 14\" role=\"img\" aria-labelledby=\"git-mosaic-title git-mosaic-description\">
        <title id=\"git-mosaic-title\">Contribution mosaic preview</title>
        <desc id=\"git-mosaic-description\">Contribution calendar from 2026-01-04 to 2026-01-04. GitHub may render different contribution levels and colors.</desc>
        <rect width=\"2\" height=\"14\" fill=\"#ffffff\"/>
        <g font-family=\"-apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, sans-serif\" font-size=\"10\" fill=\"#1f2328\">
          <g class=\"contribution-grid\">
            <rect x=\"0\" y=\"0\" width=\"2\" height=\"2\" rx=\"0.5\" fill=\"#ebedf0\" stroke=\"#d0d7de\" data-date=\"2026-01-04\" data-state=\"in-range\" data-level=\"0\"/>
            <rect x=\"0\" y=\"2\" width=\"2\" height=\"2\" rx=\"0.5\" fill=\"#f6f8fa\" stroke=\"#f6f8fa\" data-date=\"2026-01-05\" data-state=\"out-of-range\" data-level=\"-1\"/>
            <rect x=\"0\" y=\"4\" width=\"2\" height=\"2\" rx=\"0.5\" fill=\"#f6f8fa\" stroke=\"#f6f8fa\" data-date=\"2026-01-06\" data-state=\"out-of-range\" data-level=\"-1\"/>
            <rect x=\"0\" y=\"6\" width=\"2\" height=\"2\" rx=\"0.5\" fill=\"#f6f8fa\" stroke=\"#f6f8fa\" data-date=\"2026-01-07\" data-state=\"out-of-range\" data-level=\"-1\"/>
            <rect x=\"0\" y=\"8\" width=\"2\" height=\"2\" rx=\"0.5\" fill=\"#f6f8fa\" stroke=\"#f6f8fa\" data-date=\"2026-01-08\" data-state=\"out-of-range\" data-level=\"-1\"/>
            <rect x=\"0\" y=\"10\" width=\"2\" height=\"2\" rx=\"0.5\" fill=\"#f6f8fa\" stroke=\"#f6f8fa\" data-date=\"2026-01-09\" data-state=\"out-of-range\" data-level=\"-1\"/>
            <rect x=\"0\" y=\"12\" width=\"2\" height=\"2\" rx=\"0.5\" fill=\"#f6f8fa\" stroke=\"#f6f8fa\" data-date=\"2026-01-10\" data-state=\"out-of-range\" data-level=\"-1\"/>
          </g>
        </g>
      </svg>
      "
    `);
  });
});
