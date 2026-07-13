import { describe, expect, it, vi } from "vitest";
import { GitHubGraphQLProvider } from "./provider.js";

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("GitHubGraphQLProvider", () => {
  it("imports and preserves observed contribution data without exposing the token", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer secret-token",
        });
        const request = JSON.parse(String(init?.body)) as {
          variables: Record<string, string>;
        };
        expect(request.variables).toMatchObject({
          login: "octocat",
          from: "2026-01-01T00:00:00Z",
          to: "2026-01-02T23:59:59Z",
        });
        return response({
          data: {
            user: {
              contributionsCollection: {
                contributionCalendar: {
                  weeks: [
                    {
                      contributionDays: [
                        {
                          date: "2026-01-01",
                          contributionCount: 7,
                          contributionLevel: "THIRD_QUARTILE",
                          color: "#30a14e",
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        });
      },
    );
    const provider = new GitHubGraphQLProvider({
      token: "secret-token",
      fetch: fetchMock as typeof fetch,
    });
    const snapshot = await provider.fetchCalendar({
      username: "octocat",
      period: { from: "2026-01-01", to: "2026-01-02" },
      fetchedAt: "2026-01-03T00:00:00.000Z",
    });
    expect(snapshot.days[0]).toEqual({
      date: "2026-01-01",
      contributionCount: 7,
      contributionLevel: "THIRD_QUARTILE",
      color: "#30a14e",
    });
    expect(JSON.stringify(snapshot)).not.toContain("secret-token");
  });

  it("distinguishes rate limits and authentication failures without retries", async () => {
    const rateFetch = vi.fn(async () =>
      response(
        { errors: [{ type: "RATE_LIMITED", message: "limit" }] },
        { status: 403, headers: { "x-ratelimit-remaining": "0" } },
      ),
    );
    await expect(
      new GitHubGraphQLProvider({
        token: "secret",
        fetch: rateFetch as typeof fetch,
      }).fetchCalendar({
        username: "octocat",
        period: { from: "2026-01-01", to: "2026-01-02" },
      }),
    ).rejects.toThrow(/GM012|rate limit/);
    expect(rateFetch).toHaveBeenCalledTimes(1);

    const authFetch = vi.fn(async () =>
      response({ message: "bad credentials" }, { status: 401 }),
    );
    await expect(
      new GitHubGraphQLProvider({
        token: "do-not-leak",
        fetch: authFetch as typeof fetch,
      }).fetchCalendar({
        username: "octocat",
        period: { from: "2026-01-01", to: "2026-01-02" },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      const text = String(error);
      return /GitHub rejected/.test(text) && !text.includes("do-not-leak");
    });
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed calendars", async () => {
    const provider = new GitHubGraphQLProvider({
      token: "secret",
      fetch: (async () =>
        response({
          data: {
            user: {
              contributionsCollection: {
                contributionCalendar: {
                  weeks: [
                    {
                      contributionDays: [
                        { date: "not-a-date", contributionCount: -1 },
                      ],
                    },
                  ],
                },
              },
            },
          },
        })) as typeof fetch,
    });
    await expect(
      provider.fetchCalendar({
        username: "octocat",
        period: { from: "2026-01-01", to: "2026-01-02" },
      }),
    ).rejects.toThrow(/invalid contribution calendar/);
  });
});
