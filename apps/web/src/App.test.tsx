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
    createInput: undefined as unknown,
    saved: 0,
    textImported: 0,
    rendered: 0,
    renderedMode: "artistic",
    planned: 0,
    planInput: undefined as unknown,
    dryRuns: 0,
    applied: 0,
    publishChecks: 0,
    pushes: 0,
  };
  const api: WebApi = {
    async createProject(input) {
      calls.created += 1;
      calls.createInput = input;
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
    async importText() {
      calls.textImported += 1;
      return { project: project(4), report: fitReport };
    },
    async renderSvg(_path, _options, mode = "artistic") {
      calls.rendered += 1;
      calls.renderedMode = mode;
      return "<svg/>";
    },
    async createPlan(_path, input) {
      calls.planned += 1;
      calls.planInput = input;
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
    async publish(input) {
      if (input.confirmed === true) calls.pushes += 1;
      else calls.publishChecks += 1;
      return {
        repositoryPath: "/repos/art",
        branch: "main",
        remoteName: "origin",
        remoteUrl: "https://github.com/you/art.git",
        willCreateRepository: true,
        commitsToPush: 4,
        status: input.confirmed === true ? "published" : "dry-run",
        warnings: [],
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
  it("creates a managed project without exposing filesystem paths", async () => {
    const { api, calls } = fakeApi();
    const user = userEvent.setup();
    render(<App api={api} />);

    expect(
      document.querySelector('input[type="file"]'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Project path")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Repository path")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New mosaic" }));

    expect(await screen.findByText("Project created and ready.")).toBeVisible();
    expect(calls.created).toBe(1);
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("loads, paints, navigates, undoes, and saves", async () => {
    const { api, calls } = fakeApi();
    const user = await load(api);
    const grid = screen.getByRole("grid", {
      name: "Contribution mosaic canvas",
    });
    const sunday = within(grid).getByRole("gridcell", {
      name: "2026-01-04, Intensity 0",
    });

    await user.click(screen.getByRole("radio", { name: "Intensity 4" }));
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

    await user.click(screen.getByRole("radio", { name: "Intensity 3" }));
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

    await user.click(screen.getByRole("radio", { name: "Intensity 1" }));
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
    expect(await screen.findByText("Text imported.")).toBeVisible();
    expect(screen.getByText("good")).toBeVisible();
  });

  it("creates and dry-runs a plan, blocking apply until both confirmations", async () => {
    const { api, calls } = fakeApi();
    const user = await load(api);

    await user.type(screen.getByLabelText("Author name"), "Example User");
    await user.type(screen.getByLabelText("Author email"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Create plan" }));

    expect(await screen.findByText("0123456789abcdef")).toBeInTheDocument();
    expect(calls.planned).toBe(1);
    // Before the dry run there is no dead form to fill in: no Apply button,
    // no disclosure, no confirmation field.
    expect(
      screen.queryByRole("button", { name: "Apply plan" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Type "APPLY" to confirm'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dry run" }));
    await waitFor(() => expect(calls.dryRuns).toBe(1));
    expect(screen.getByText(/dry-run/)).toBeInTheDocument();

    const apply = screen.getByRole("button", { name: "Apply plan" });
    expect(apply).toBeDisabled();
    await user.click(apply);
    expect(calls.applied).toBe(0);

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

  it("creates the project with the typed name and the chosen calendar year", async () => {
    const { api, calls } = fakeApi();
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "Hire me");
    await user.selectOptions(screen.getByLabelText("Time span"), "year");
    await user.clear(screen.getByLabelText("Year"));
    await user.type(screen.getByLabelText("Year"), "2025");
    await user.click(screen.getByRole("button", { name: "New mosaic" }));

    await screen.findByText("Project created and ready.");
    expect(calls.createInput).toMatchObject({
      name: "Hire me",
      periodMode: "year",
      year: 2025,
    });
  });

  it("offers a custom range instead of a fixed year", async () => {
    const { api, calls } = fakeApi();
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.selectOptions(screen.getByLabelText("Time span"), "custom");
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-02-01" },
    });
    await user.click(screen.getByRole("button", { name: "New mosaic" }));

    await screen.findByText("Project created and ready.");
    expect(calls.createInput).toMatchObject({
      periodMode: "custom",
      from: "2026-01-01",
      to: "2026-02-01",
    });
  });

  it("says so when the estimate cannot differ from the drawing", async () => {
    const { api } = fakeApi();
    const user = await load(api);

    await user.click(screen.getByRole("radio", { name: "Intensity 3" }));
    await user.click(
      within(screen.getByRole("grid")).getByRole("gridcell", {
        name: "2026-01-04, Intensity 0",
      }),
    );
    await user.click(screen.getByRole("button", { name: "GitHub estimate" }));
    expect(screen.getByText(/Only one intensity is in use/)).toBeVisible();
  });

  it("gates the review and apply steps behind the plan and the dry run", async () => {
    const { api, calls } = fakeApi();
    const user = await load(api);

    expect(screen.getByText("Create a plan to review it here.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Dry run" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Apply plan" }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Author name"), "Example User");
    await user.type(screen.getByLabelText("Author email"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Create plan" }));

    expect(
      await screen.findByRole("button", { name: "Dry run" }),
    ).toBeEnabled();
    expect(screen.getByText("Run the dry run before applying.")).toBeVisible();

    // A locked Apply step must never render a form that cannot submit: no
    // Apply button, no disclosure, no confirmation field until the dry run.
    expect(
      screen.queryByRole("button", { name: "Apply plan" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Type "APPLY" to confirm'),
    ).not.toBeInTheDocument();

    // Instead it offers the action that unlocks it.
    await user.click(screen.getByRole("button", { name: "Run the dry run" }));
    await waitFor(() => expect(calls.dryRuns).toBe(1));
    expect(screen.getByRole("button", { name: "Apply plan" })).toBeDisabled();
    expect(screen.getByLabelText('Type "APPLY" to confirm')).toBeVisible();
  });

  it("toggles the numeric cell values without changing the drawing", async () => {
    const { api } = fakeApi();
    const user = await load(api);
    const grid = screen.getByRole("grid", {
      name: "Contribution mosaic canvas",
    });
    const cell = () =>
      within(grid).getByRole("gridcell", { name: /^2026-01-04/ });

    await user.click(screen.getByRole("radio", { name: "Intensity 2" }));
    await user.click(cell());
    expect(cell()).toHaveTextContent("2");

    await user.click(screen.getByRole("button", { name: "Values" }));
    expect(cell()).toHaveTextContent("");
    expect(cell()).toHaveAccessibleName("2026-01-04, Intensity 2");
  });

  it("labels the calendar with localized months and weekdays", async () => {
    const { api } = fakeApi();
    const user = await load(api);

    expect(screen.getByText("Jan")).toBeVisible();
    expect(screen.getByText("Mon")).toBeVisible();

    await user.selectOptions(screen.getByLabelText("Language"), "pt-BR");
    expect(screen.getByText("jan.")).toBeVisible();
    expect(screen.getByText("seg.")).toBeVisible();
  });

  it("reports failures as an error alert instead of a success message", async () => {
    const { api } = fakeApi();
    const user = userEvent.setup();
    render(
      <App
        api={{
          ...api,
          async createProject() {
            throw new Error("EPERM workspace is not writable");
          },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New mosaic" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("EPERM workspace is not writable");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("only pushes after apply, a check, and a typed confirmation", async () => {
    const { api, calls } = fakeApi();
    const user = await load(api);

    // Publishing is locked until the plan is actually applied.
    expect(screen.getByText("Apply the plan before publishing.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Push to GitHub" }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Author name"), "Example User");
    await user.type(screen.getByLabelText("Author email"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Create plan" }));
    await screen.findByRole("button", { name: "Dry run" });
    await user.click(screen.getByRole("button", { name: "Dry run" }));
    await waitFor(() => expect(calls.dryRuns).toBe(1));
    await user.click(
      screen.getByLabelText(
        "I understand this creates artificial-history artwork commits and does not push them.",
      ),
    );
    await user.type(screen.getByLabelText('Type "APPLY" to confirm'), "APPLY");
    await user.click(screen.getByRole("button", { name: "Apply plan" }));
    await waitFor(() => expect(calls.applied).toBe(1));

    // Now publishing unlocks, but the push button only exists after a check.
    await user.type(screen.getByLabelText("GitHub repository"), "you/art");
    expect(
      screen.queryByRole("button", { name: "Push to GitHub" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Check push" }));
    await waitFor(() => expect(calls.publishChecks).toBe(1));
    expect(calls.pushes).toBe(0);

    const push = screen.getByRole("button", { name: "Push to GitHub" });
    expect(push).toBeDisabled();
    await user.click(push);
    expect(calls.pushes).toBe(0);

    await user.type(screen.getByLabelText('Type "PUSH" to confirm'), "PUSH");
    expect(push).toBeEnabled();
    await user.click(push);
    await waitFor(() => expect(calls.pushes).toBe(1));
    expect(
      await screen.findByText(/Pushed\. Contributions appear/),
    ).toBeVisible();
  });

  it("previews the real commit message and sends the template with the plan", async () => {
    const { api, calls } = fakeApi();
    const user = await load(api);

    // The default template is shown rendered, not as a raw template.
    expect(
      screen.getByText("git-mosaic: pixel 2025-03-14 (1/0)"),
    ).toBeVisible();

    // fireEvent, not user.type: userEvent reads "{date}" as a key descriptor.
    const template = screen.getByLabelText("Commit message");
    fireEvent.change(template, {
      target: { value: "art: {date} for {project}" },
    });
    expect(screen.getByText("art: 2025-03-14 for sample")).toBeVisible();

    await user.type(screen.getByLabelText("Author name"), "Example User");
    await user.type(screen.getByLabelText("Author email"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() => expect(calls.planned).toBe(1));
    expect(calls.planInput).toMatchObject({
      messageTemplate: "art: {date} for {project}",
    });
  });

  it("commits a README by default and lets it be edited or dropped", async () => {
    const { api, calls } = fakeApi();
    const user = await load(api);

    const readme = screen.getByLabelText("README.md") as HTMLTextAreaElement;
    expect(readme.value).toContain("# sample");
    // The default README discloses what the history is (the text wraps lines).
    expect(readme.value.replace(/\s+/g, " ")).toContain("contribution artwork");

    await user.clear(readme);
    await user.type(readme, "# my art");
    await user.type(screen.getByLabelText("Author name"), "Example User");
    await user.type(screen.getByLabelText("Author email"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() => expect(calls.planned).toBe(1));
    expect(calls.planInput).toMatchObject({
      files: [{ path: "README.md", content: "# my art" }],
    });

    // Unchecking removes it from the plan entirely.
    await user.click(screen.getByLabelText("Commit a README.md"));
    expect(screen.queryByLabelText("README.md")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create plan" }));
    await waitFor(() => expect(calls.planned).toBe(2));
    expect(calls.planInput).not.toHaveProperty("files");
  });
});
