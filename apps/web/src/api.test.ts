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
          input: { name: "new-art", timezone: "America/Los_Angeles" },
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
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/project/create",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses a session header for mutations and encodes image files", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/session")) {
          return new Response(JSON.stringify({ session: "session-token" }), {
            status: 200,
          });
        }
        expect(init?.headers).toMatchObject({
          "X-Git-Mosaic-Session": "session-token",
        });
        if (url.endsWith("/api/image/import")) {
          const body = JSON.parse(String(init?.body)) as {
            fileName: string;
            dataBase64: string;
          };
          expect(body).toEqual({
            fileName: "pixel.png",
            dataBase64: "AAEC",
            path: "/project",
            options: {},
          });
        }
        return new Response(
          JSON.stringify({
            project: {
              schemaVersion: 1,
              name: "test",
            },
          }),
          { status: 200 },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = createWebApi("http://127.0.0.1:4173");
    const file = new File([new Uint8Array([0, 1, 2])], "pixel.png", {
      type: "image/png",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([0, 1, 2]).buffer,
    });
    await api.importImage("/project", file);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
