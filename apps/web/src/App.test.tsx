// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { ExecutionResult } from "@git-mosaic/git";
import type { CommitPlan, FitReport, MosaicProject } from "@git-mosaic/schemas";
import { App } from "./App.js";
import type { WebApi } from "./contracts.js";

afterEach(cleanup);

function project(intensity = 0): MosaicProject {
  return {
    schemaVersion: 1,
    name: "sample",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    period: { from: "2026-01-04", to: "2026-01-10" },
    timezone: "UTC",
    weekStartsOn: 0,
    dimensions: { rows: 7, columns: 1 },
    source: { type: "empty" },
    intensityMap: Array.from({ length: 7 }, () => [
      intensity,
    ]) as MosaicProject["intensityMap"],
    commitLevelMap: { 0: 0, 1: 1, 2: 4, 3: 10, 4: 20 },
  };
}

const plan = {
  planId: "0123456789abcdef",
  totals: { commits: 4, days: 1, maximumCommitsPerDay: 4 },
  repository: { mode: "new", path: "/repos/art", branch: "main" },
} as CommitPlan;

const result: ExecutionResult = {
  repositoryPath: "/repos/art",
  repositoryMode: "new",
  branch: "main",
  applicationState: "not_started",
  appliedSteps: 0,
  totalSteps: 4,
  hasRemotes: false,
  remotes: [],
  gitVersion: "git version 2.45.0",
  warnings: [],
  status: "dry-run",
  createdCommits: 0,
};

const fitReport: FitReport = {
  verdict: "good",
  score: 1,
  signals: {},
  survives: ["large shapes"],
  lost: [],
  remedies: [],
};

function fakeApi() {
  const calls = {
    created: 0,
    saved: 0,
    imported: 0,
    textImported: 0,
    rendered: 0,
    renderedMode: "artistic",
    planned: 0,
    dryRuns: 0,
    applied: 0,
  };
  const api: WebApi = {
    async createProject() {
      calls.created += 1;
      return {
        project: project(),
        projectPath: "/managed/project",
        repositoryPath: "/managed/project/repository",
      };
    },
    async loadProject() {
      return project();
    },
    async saveProject(_path, value) {
      calls.saved += 1;
      return value;
    },
    async importImage() {
      calls.imported += 1;
      return { project: project(2), report: fitReport };
    },
    async importText() {
      calls.textImported += 1;
      return { project: project(4), report: fitReport };
    },
    async debugImage() {
      return { width: 1, height: 1, intensitiesBase64: "" };
    },
    async renderSvg(_path, _options, mode = "artistic") {
      calls.rendered += 1;
      calls.renderedMode = mode;
      return "<svg/>";
    },
    async createPlan() {
      calls.planned += 1;
      return { plan, planPath: "/project/plans/plan.json" };
    },
    async dryRun() {
      calls.dryRuns += 1;
      return result;
    },
    async apply() {
      calls.applied += 1;
      return {
        ...result,
        status: "complete",
        applicationState: "complete",
        createdCommits: 4,
      };
    },
  };
  return { api, calls };
}

async function load(api: WebApi) {
  const user = userEvent.setup();
  render(<App api={api} />);
  await user.click(screen.getByRole("button", { name: "New mosaic" }));
  await screen.findByText("Project created and ready.");
  return user;
}

describe("App", () => {
  it("creates a managed project and keeps the image picker available before setup", async () => {
    const { api, calls } = fakeApi();
    const user = userEvent.setup();
    render(<App api={api} />);

    expect(screen.getByLabelText(/Drop an image here/)).toBeEnabled();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Project path")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Repository path")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New mosaic" }));

    expect(await screen.findByText("Project created and ready.")).toBeVisible();
    expect(calls.created).toBe(1);
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("loads, paints, navigates, undoes, saves, and imports a dropped image", async () => {
    const { api, calls } = fakeApi();
    const user = await load(api);
    const grid = screen.getByRole("grid", {
      name: "Contribution mosaic canvas",
    });
    const sunday = within(grid).getByRole("gridcell", {
      name: "2026-01-04, Intensity 0",
    });

    await user.click(screen.getByRole("button", { name: "Intensity 4" }));
    await user.click(sunday);
    expect(
      within(grid).getByRole("gridcell", { name: "2026-01-04, Intensity 4" }),
    ).toHaveTextContent("4");
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      within(grid).getByRole("gridcell", { name: "2026-01-04, Intensity 0" }),
    ).toBeInTheDocument();

    const monday = within(grid).getByRole("gridcell", {
      name: "2026-01-05, Intensity 0",
    });
    sunday.focus();
    await user.keyboard("{ArrowDown}");
    expect(monday).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Intensity 3" }));
    fireEvent.pointerDown(monday, { pointerId: 1 });
    fireEvent.pointerEnter(
      within(grid).getByRole("gridcell", { name: "2026-01-06, Intensity 0" }),
    );
    fireEvent.pointerUp(grid);
    expect(
      within(grid).getByRole("gridcell", { name: "2026-01-06, Intensity 3" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save mosaic.json" }));
    await waitFor(() => expect(calls.saved).toBe(1));

    const file = new File(["pixels"], "art.png", { type: "image/png" });
    fireEvent.drop(screen.getByText("Drop an image here or choose a file"), {
      dataTransfer: { files: [file] },
    });
    await waitFor(() => expect(calls.imported).toBe(1));
    expect(
      screen.getByRole("button", { name: "Original-pixel debug" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/Quantized source image/)).toHaveAttribute(
      "width",
      "1",
    );
    await user.click(
      screen.getByRole("button", { name: "Contribution preview" }),
    );
    expect(
      within(screen.getByRole("grid")).getByRole("gridcell", {
        name: "2026-01-04, Intensity 2",
      }),
    ).toBeInTheDocument();
  });

  it("imports text and switches the preview and SVG export to estimate mode", async () => {
    const { api, calls } = fakeApi();
    const user = await load(api);
    const grid = screen.getByRole("grid", {
      name: "Contribution mosaic canvas",
    });
    const artistic = screen.getByRole("button", {
      name: "Drawn intensities",
    });
    expect(artistic).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Intensity 1" }));
    await user.click(
      within(grid).getByRole("gridcell", {
        name: "2026-01-04, Intensity 0",
      }),
    );
    expect(
      within(grid).getByRole("gridcell", {
        name: "2026-01-04, Intensity 1",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "GitHub estimate" }));
    expect(
      within(grid).getByRole("gridcell", {
        name: "2026-01-04, Intensity 4",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export SVG" }));
    await waitFor(() => expect(calls.rendered).toBe(1));
    expect(calls.renderedMode).toBe("estimate");

    const text = screen.getByLabelText("Write text");
    await user.clear(text);
    await user.type(text, "HI");
    await user.selectOptions(screen.getByLabelText("Text alignment"), "left");
    await user.click(screen.getByRole("button", { name: "Import text" }));
    await waitFor(() => expect(calls.textImported).toBe(1));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Text imported. — fit good",
    );
  });

  it("creates and dry-runs a plan, blocking apply until both confirmations", async () => {
    const { api, calls } = fakeApi();
    const user = await load(api);

    await user.type(screen.getByLabelText("Author name"), "Example User");
    await user.type(screen.getByLabelText("Author email"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Create plan" }));

    expect(await screen.findByText("0123456789abcdef")).toBeInTheDocument();
    expect(calls.planned).toBe(1);
    const apply = screen.getByRole("button", { name: "Apply plan" });
    expect(apply).toBeDisabled();
    await user.click(apply);
    expect(calls.applied).toBe(0);

    await user.click(screen.getByRole("button", { name: "Dry run" }));
    await waitFor(() => expect(calls.dryRuns).toBe(1));
    expect(screen.getByText(/dry-run/)).toBeInTheDocument();

    await user.click(
      screen.getByLabelText(
        "I understand this creates artificial-history artwork commits and does not push them.",
      ),
    );
    expect(apply).toBeDisabled();
    await user.type(screen.getByLabelText('Type "APPLY" to confirm'), "APPLY");
    expect(apply).toBeEnabled();
    await user.click(apply);
    await waitFor(() => expect(calls.applied).toBe(1));
    expect(
      screen.getByText("complete", { selector: "strong" }),
    ).toBeInTheDocument();
  });
});
