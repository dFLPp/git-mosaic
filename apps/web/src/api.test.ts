// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebApi } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("web API client", () => {
  it("creates a project with its name and browser timezone", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ session: "session-token" }), {
          status: 200,
        }),
      )
      .mockImplementationOnce(async (_input, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          input: {
            name: "new-art",
            timezone: "America/Los_Angeles",
            periodMode: "year",
            year: 2025,
          },
        });
        return new Response(
          JSON.stringify({
            project: { schemaVersion: 1, name: "new-art" },
            projectPath: "/managed/new-art",
            repositoryPath: "/managed/new-art/repository",
          }),
          { status: 201 },
        );
      });
    vi.stubGlobal("fetch", fetchMock);

    await createWebApi().createProject({
      name: "new-art",
      timezone: "America/Los_Angeles",
      periodMode: "year",
      year: 2025,
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/project/create",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends text imports and the selected SVG preview mode", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/session")) {
          return new Response(JSON.stringify({ session: "session-token" }), {
            status: 200,
          });
        }
        requests.push({
          url,
          body: JSON.parse(String(init?.body)) as unknown,
        });
        return new Response(
          JSON.stringify(
            url.endsWith("/api/preview/svg")
              ? { svg: "<svg/>" }
              : {
                  project: { schemaVersion: 1, name: "test" },
                  report: {
                    verdict: "good",
                    score: 1,
                    signals: {},
                    survives: [],
                    lost: [],
                    remedies: [],
                  },
                },
          ),
          { status: 200 },
        );
      }),
    );

    const api = createWebApi();
    await api.importText("/project", "Loading...", { align: "right" });
    await api.renderSvg("/project", { theme: "dark" }, "estimate");

    expect(requests).toEqual([
      {
        url: "/api/text/import",
        body: {
          path: "/project",
          content: "Loading...",
          options: { align: "right" },
        },
      },
      {
        url: "/api/preview/svg",
        body: {
          path: "/project",
          options: { theme: "dark" },
          mode: "estimate",
        },
      },
    ]);
  });

  it("surfaces stable server errors without exposing response internals", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ session: "session" }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: "GM001",
                message: "Invalid project",
                hint: "Check path",
              },
            }),
            { status: 400 },
          ),
        ),
    );
    await expect(createWebApi().loadProject("/missing")).rejects.toThrow(
      "GM001 Invalid project\nCheck path",
    );
  });
});
