import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeProject, readProject, writeProject } from "@git-mosaic/core";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalServer, type LocalServerOptions } from "./server.js";

const directories: string[] = [];
const servers: ReturnType<typeof createLocalServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          );
        }),
    ),
  );
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

async function startServer(options: LocalServerOptions = {}) {
  const server = createLocalServer(options);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function session(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/session`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { session: string }).session;
}

async function post(
  baseUrl: string,
  token: string,
  route: string,
  body: unknown,
) {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-git-mosaic-session": token,
    },
    body: JSON.stringify(body),
  });
}

async function textProject(): Promise<string> {
  const directory = await temporaryDirectory("git-mosaic-web-fit-");
  await initializeProject(directory, {
    name: "web-fit",
    period: { from: "2025-01-01", to: "2025-12-31" },
    timezone: "UTC",
  });
  return directory;
}

describe("project creation", () => {
  it("names the directory from the project and its span, under the output root", async () => {
    const outputRoot = await temporaryDirectory("git-mosaic-output-");
    const { baseUrl } = await startServer({ outputRoot });
    const token = await session(baseUrl);

    const response = await post(baseUrl, token, "/api/project/create", {
      input: {
        name: "Hire me!",
        timezone: "UTC",
        periodMode: "year",
        year: 2025,
      },
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      project: { name: string; period: { from: string; to: string } };
      projectPath: string;
      repositoryPath: string;
    };
    expect(path.basename(body.projectPath)).toBe("hire-me-2025");
    expect(path.dirname(body.projectPath)).toBe(outputRoot);
    expect(body.project.name).toBe("Hire me!");
    expect(body.project.period).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
    expect(await readProject(body.projectPath)).toMatchObject({
      name: "Hire me!",
    });
  });

  it("honours a custom range and never overwrites an existing project", async () => {
    const outputRoot = await temporaryDirectory("git-mosaic-output-");
    const { baseUrl } = await startServer({ outputRoot });
    const token = await session(baseUrl);
    const input = {
      name: "promo",
      timezone: "UTC",
      periodMode: "custom",
      from: "2026-01-01",
      to: "2026-02-01",
    };

    const first = await post(baseUrl, token, "/api/project/create", { input });
    const second = await post(baseUrl, token, "/api/project/create", { input });

    const one = (await first.json()) as {
      projectPath: string;
      project: { period: { from: string; to: string } };
    };
    const two = (await second.json()) as { projectPath: string };
    expect(one.project.period).toEqual({
      from: "2026-01-01",
      to: "2026-02-01",
    });
    expect(path.basename(one.projectPath)).toBe("promo-2026-01-01_2026-02-01");
    expect(path.basename(two.projectPath)).toBe(
      "promo-2026-01-01_2026-02-01-2",
    );
  });

  it("plans with a commit message template and a README file", async () => {
    const outputRoot = await temporaryDirectory("git-mosaic-output-");
    const { baseUrl } = await startServer({ outputRoot });
    const token = await session(baseUrl);
    const created = (await (
      await post(baseUrl, token, "/api/project/create", {
        input: {
          name: "plan-files",
          timezone: "UTC",
          periodMode: "year",
          year: 2025,
        },
      })
    ).json()) as { projectPath: string; repositoryPath: string };
    await post(baseUrl, token, "/api/text/import", {
      path: created.projectPath,
      content: "HI",
      options: {},
    });

    const response = await post(baseUrl, token, "/api/plan/create", {
      path: created.projectPath,
      input: {
        repositoryPath: created.repositoryPath,
        branch: "main",
        repositoryMode: "new",
        authorName: "Example User",
        authorEmail: "user@example.com",
        commitMode: "empty",
        messageTemplate: "art: {project} {date}",
        files: [{ path: "README.md", content: "# plan-files\n" }],
      },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      plan: {
        strategy: { messageTemplate: string };
        files: { path: string; content: string }[];
        days: { commits: { message: string }[] }[];
      };
    };
    expect(body.plan.strategy.messageTemplate).toBe("art: {project} {date}");
    expect(body.plan.files).toEqual([
      { path: "README.md", content: "# plan-files\n" },
    ]);
    expect(body.plan.days[0]?.commits[0]?.message).toMatch(/^art: plan-files /);
  });

  it("refuses repository files that escape the repository", async () => {
    const outputRoot = await temporaryDirectory("git-mosaic-output-");
    const { baseUrl } = await startServer({ outputRoot });
    const token = await session(baseUrl);
    const created = (await (
      await post(baseUrl, token, "/api/project/create", {
        input: {
          name: "escape",
          timezone: "UTC",
          periodMode: "year",
          year: 2025,
        },
      })
    ).json()) as { projectPath: string; repositoryPath: string };

    const response = await post(baseUrl, token, "/api/plan/create", {
      path: created.projectPath,
      input: {
        repositoryPath: created.repositoryPath,
        branch: "main",
        repositoryMode: "new",
        authorName: "Example User",
        authorEmail: "user@example.com",
        commitMode: "empty",
        files: [{ path: "../../etc/passwd", content: "x" }],
      },
    });

    expect(response.status).toBe(400);
  });

  it("rejects an out-of-range year", async () => {
    const outputRoot = await temporaryDirectory("git-mosaic-output-");
    const { baseUrl } = await startServer({ outputRoot });
    const token = await session(baseUrl);

    const response = await post(baseUrl, token, "/api/project/create", {
      input: { name: "x", timezone: "UTC", periodMode: "year", year: 1800 },
    });

    expect(response.status).toBe(400);
  });
});

describe("local web server boundaries", () => {
  it("does not expose the removed image routes", async () => {
    const { baseUrl } = await startServer();
    const token = await session(baseUrl);

    for (const route of ["/api/image/import", "/api/image/debug"]) {
      const response = await post(baseUrl, token, route, {});
      expect(response.status).toBe(404);
    }
  });

  it("binds through the caller, serves static files, and protects every POST", async () => {
    const staticRoot = await temporaryDirectory("git-mosaic-web-static-");
    await writeFile(
      path.join(staticRoot, "index.html"),
      "<h1>local mosaic</h1>",
    );
    const { baseUrl } = await startServer({
      staticRoot,
      sessionToken: "known-session",
      allowedOrigins: ["http://127.0.0.1:4173"],
    });

    const page = await fetch(`${baseUrl}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("local mosaic");

    const missingSession = await fetch(`${baseUrl}/api/project/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/tmp/does-not-matter" }),
    });
    expect(missingSession.status).toBe(403);

    const externalOrigin = await fetch(`${baseUrl}/api/project/load`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-git-mosaic-session": "known-session",
        origin: "https://attacker.example",
      },
      body: JSON.stringify({ path: "/tmp/does-not-matter" }),
    });
    expect(externalOrigin.status).toBe(403);
    expect(JSON.stringify(await externalOrigin.json())).not.toContain(
      "known-session",
    );

    const trustedProxyOrigin = await fetch(`${baseUrl}/api/project/load`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-git-mosaic-session": "known-session",
        origin: "http://127.0.0.1:4173",
      },
      body: JSON.stringify({ path: "/tmp/does-not-exist" }),
    });
    expect(trustedProxyOrigin.status).toBe(400);
  });

  it("rejects oversized and invalid JSON bodies without exposing the session", async () => {
    const { baseUrl } = await startServer({
      sessionToken: "body-session",
      maximumBodyBytes: 128,
    });
    const oversized = await post(baseUrl, "body-session", "/api/project/load", {
      path: "x".repeat(200),
    });
    expect(oversized.status).toBe(413);
    expect(JSON.stringify(await oversized.json())).not.toContain(
      "body-session",
    );

    const invalid = await fetch(`${baseUrl}/api/project/load`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-git-mosaic-session": "body-session",
      },
      body: "{",
    });
    expect(invalid.status).toBe(400);
  });
});

describe("local web API", () => {
  it("creates a ready-to-use rolling-year project", async () => {
    const { baseUrl } = await startServer();
    const token = await session(baseUrl);

    const response = await post(baseUrl, token, "/api/project/create", {
      input: { name: "new-project", timezone: "UTC" },
    });

    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      projectPath: string;
      repositoryPath: string;
      project: { name: string };
    };
    expect(created).toMatchObject({
      project: {
        name: "new-project",
        timezone: "UTC",
        dimensions: { rows: 7 },
      },
    });
    directories.push(created.projectPath);
    expect(created.repositoryPath).toBe(
      path.join(created.projectPath, "repository"),
    );
    expect(
      JSON.parse(
        await readFile(path.join(created.projectPath, "mosaic.json"), "utf8"),
      ),
    ).toMatchObject({ name: "new-project" });
  });

  it("loads, saves, imports, previews, plans, dry-runs, and applies with confirmation", async () => {
    const root = await temporaryDirectory("git-mosaic-web-api-");
    const projectPath = path.join(root, "project");
    const repositoryPath = path.join(root, "repository");
    await initializeProject(projectPath, {
      name: "web-test",
      period: { from: "2026-01-04", to: "2026-01-10" },
      timezone: "UTC",
      now: "2026-01-01T00:00:00.000Z",
    });
    const { baseUrl } = await startServer();
    const token = await session(baseUrl);

    const loadedResponse = await post(baseUrl, token, "/api/project/load", {
      path: projectPath,
    });
    expect(loadedResponse.status).toBe(200);
    const { project: loaded } = (await loadedResponse.json()) as {
      project: { intensityMap: number[][] };
    };
    loaded.intensityMap[0]![0] = 1;

    const savedResponse = await post(baseUrl, token, "/api/project/save", {
      path: projectPath,
      project: loaded,
    });
    expect(savedResponse.status).toBe(200);

    const previewResponse = await post(baseUrl, token, "/api/preview/svg", {
      path: projectPath,
      options: { theme: "dark", tooltips: false },
    });
    expect(previewResponse.status).toBe(200);
    expect(((await previewResponse.json()) as { svg: string }).svg).toContain(
      "<svg",
    );

    const planResponse = await post(baseUrl, token, "/api/plan/create", {
      path: projectPath,
      input: {
        repositoryPath,
        branch: "main",
        repositoryMode: "new",
        authorName: "Web Author",
        authorEmail: "web@example.com",
        commitMode: "empty",
      },
    });
    expect(planResponse.status).toBe(200);
    const { planPath } = (await planResponse.json()) as { planPath: string };

    const dryRun = await post(baseUrl, token, "/api/plan/dry-run", {
      planPath,
    });
    expect(dryRun.status).toBe(200);
    expect(await dryRun.json()).toMatchObject({
      result: { status: "dry-run", createdCommits: 0 },
    });

    const unconfirmed = await post(baseUrl, token, "/api/plan/apply", {
      planPath,
      confirmed: false,
    });
    expect(unconfirmed.status).toBe(400);
    await expect(
      readFile(path.join(repositoryPath, ".git", "HEAD"), "utf8"),
    ).rejects.toThrow();

    const applied = await post(baseUrl, token, "/api/plan/apply", {
      planPath,
      confirmed: true,
    });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({
      result: { status: "complete" },
    });
    expect(
      await readFile(path.join(repositoryPath, ".git", "HEAD"), "utf8"),
    ).toContain("main");
  });

  it("rejects a plan whose checksum was changed on disk", async () => {
    const root = await temporaryDirectory("git-mosaic-web-checksum-");
    const projectPath = path.join(root, "project");
    await initializeProject(projectPath, {
      name: "checksum-test",
      period: { from: "2026-01-04", to: "2026-01-10" },
      timezone: "UTC",
      now: "2026-01-01T00:00:00.000Z",
    });
    const { baseUrl } = await startServer();
    const token = await session(baseUrl);
    const response = await post(baseUrl, token, "/api/plan/create", {
      path: projectPath,
      input: {
        repositoryPath: path.join(root, "repository"),
        branch: "main",
        repositoryMode: "new",
        authorName: "Checksum Author",
        authorEmail: "checksum@example.com",
        commitMode: "empty",
      },
    });
    const { planPath, plan } = (await response.json()) as {
      planPath: string;
      plan: Record<string, unknown>;
    };
    await writeFile(
      planPath,
      JSON.stringify({ ...plan, projectName: "tampered" }),
    );

    const dryRun = await post(baseUrl, token, "/api/plan/dry-run", {
      planPath,
    });
    expect(dryRun.status).toBe(400);
    expect(await dryRun.json()).toMatchObject({ error: { code: "GM013" } });
  });
});

describe("text import over the local API", () => {
  it("imports text and returns the project with its fit report", async () => {
    const directory = await textProject();
    const { baseUrl } = await startServer();
    const token = await session(baseUrl);

    const response = await post(baseUrl, token, "/api/text/import", {
      path: directory,
      content: "Loading...",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      project: { source: { type: string; font: string } };
      report: { verdict: string; signals: { fontTier: string } };
    };
    expect(body.project.source).toMatchObject({ type: "text", font: "5x7" });
    expect(body.report.verdict).toBe("good");
    expect(body.report.signals.fontTier).toBe("5x7");
  });

  it("reports text that cannot fit as a GM016 error", async () => {
    const directory = await textProject();
    const { baseUrl } = await startServer();
    const token = await session(baseUrl);

    const response = await post(baseUrl, token, "/api/text/import", {
      path: directory,
      content: "lorem ipsum dolor".repeat(5),
    });
    expect(response.ok).toBe(false);
    const body = (await response.json()) as {
      error: { code: string; message: string; hint?: string };
    };
    expect(body.error.code).toBe("GM016");
    expect(body.error.message).toMatch(/columns/);
  });
});

describe("preview modes over the local API", () => {
  it("renders artistic by default, estimate on request, and rejects invalid modes", async () => {
    const directory = await temporaryDirectory("git-mosaic-web-preview-");
    const project = await initializeProject(directory, {
      name: "web-preview",
      period: { from: "2026-01-04", to: "2026-01-10" },
      timezone: "UTC",
    });
    project.intensityMap[0]![0] = 1;
    await writeProject(directory, project);
    expect((await readProject(directory)).intensityMap[0]?.[0]).toBe(1);

    const { baseUrl } = await startServer();
    const token = await session(baseUrl);
    const artistic = await post(baseUrl, token, "/api/preview/svg", {
      path: directory,
    });
    expect(artistic.status).toBe(200);
    expect(((await artistic.json()) as { svg: string }).svg).toContain(
      'data-date="2026-01-04" data-state="in-range" data-level="1"',
    );

    const estimate = await post(baseUrl, token, "/api/preview/svg", {
      path: directory,
      mode: "estimate",
    });
    expect(estimate.status).toBe(200);
    expect(((await estimate.json()) as { svg: string }).svg).toContain(
      'data-date="2026-01-04" data-state="in-range" data-level="4"',
    );

    const invalid = await post(baseUrl, token, "/api/preview/svg", {
      path: directory,
      mode: "unknown",
    });
    expect(invalid.status).toBe(400);
  });
});
