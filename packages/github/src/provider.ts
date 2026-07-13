import {
  contributionSnapshotSchema,
  dateRangeSchema,
  GitMosaicError,
  type ContributionSnapshot,
  type DateRange,
} from "@git-mosaic/schemas";

export interface GitHubCalendarRequest {
  username: string;
  period: DateRange;
  fetchedAt?: string;
}

export interface GitHubContributionProvider {
  fetchCalendar(input: GitHubCalendarRequest): Promise<ContributionSnapshot>;
}

interface ContributionDayResponse {
  date?: unknown;
  contributionCount?: unknown;
  contributionLevel?: unknown;
  color?: unknown;
}

interface GraphQLResponse {
  data?: {
    user?: {
      contributionsCollection?: {
        contributionCalendar?: {
          weeks?: Array<{ contributionDays?: ContributionDayResponse[] }>;
        };
      };
    } | null;
  };
  errors?: Array<{ message?: string; type?: string }>;
}

const contributionCalendarQuery = `
query ContributionCalendar($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
            color
          }
        }
      }
    }
  }
}`;

function isRateLimited(response: Response, body?: GraphQLResponse): boolean {
  return (
    response.headers.get("x-ratelimit-remaining") === "0" ||
    body?.errors?.some((error) => error.type === "RATE_LIMITED") === true
  );
}

export class GitHubGraphQLProvider implements GitHubContributionProvider {
  readonly #token: string;
  readonly fetchImplementation: typeof fetch;
  readonly endpoint: string;

  constructor(options: {
    token: string;
    fetch?: typeof fetch;
    endpoint?: string;
  }) {
    if (!options.token.trim()) {
      throw new GitMosaicError(
        "GITHUB_AUTH_FAILED",
        "A GitHub token is required",
      );
    }
    this.#token = options.token;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.endpoint = options.endpoint ?? "https://api.github.com/graphql";
  }

  async fetchCalendar(
    input: GitHubCalendarRequest,
  ): Promise<ContributionSnapshot> {
    const period = dateRangeSchema.safeParse(input.period);
    if (!period.success) {
      throw new GitMosaicError(
        "INVALID_DATE_RANGE",
        "Invalid GitHub snapshot period",
        {
          cause: period.error,
        },
      );
    }
    if (!input.username.trim()) {
      throw new GitMosaicError(
        "INVALID_PROJECT",
        "GitHub username is required",
      );
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.#token}`,
          "Content-Type": "application/json",
          "User-Agent": "git-mosaic",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          query: contributionCalendarQuery,
          variables: {
            login: input.username,
            from: `${period.data.from}T00:00:00Z`,
            to: `${period.data.to}T23:59:59Z`,
          },
        }),
      });
    } catch (cause) {
      throw new GitMosaicError(
        "GITHUB_AUTH_FAILED",
        "Could not contact the GitHub GraphQL API",
        {
          hint: "Check network access and try again; no automatic retry was performed",
          cause,
        },
      );
    }

    let body: GraphQLResponse;
    try {
      body = (await response.json()) as GraphQLResponse;
    } catch (cause) {
      throw new GitMosaicError(
        "GITHUB_AUTH_FAILED",
        "GitHub returned an invalid response",
        { cause },
      );
    }
    if (isRateLimited(response, body)) {
      throw new GitMosaicError(
        "GITHUB_RATE_LIMITED",
        "GitHub API rate limit reached",
        {
          hint: "Wait for the limit to reset or continue offline with an existing snapshot",
        },
      );
    }
    if (!response.ok || body.errors !== undefined) {
      throw new GitMosaicError(
        "GITHUB_AUTH_FAILED",
        "GitHub rejected the calendar request",
        {
          hint: "Verify token permissions and username",
        },
      );
    }
    const calendar =
      body.data?.user?.contributionsCollection?.contributionCalendar;
    if (body.data?.user === null || calendar === undefined) {
      throw new GitMosaicError(
        "INVALID_PROJECT",
        `GitHub user was not found: ${input.username}`,
      );
    }
    const days = (calendar.weeks ?? []).flatMap(
      (week) => week.contributionDays ?? [],
    );
    const snapshot = contributionSnapshotSchema.safeParse({
      schemaVersion: 1,
      username: input.username,
      period: period.data,
      fetchedAt: input.fetchedAt ?? new Date().toISOString(),
      days: days.map((day) => ({
        date: day.date,
        contributionCount: day.contributionCount,
        contributionLevel: day.contributionLevel,
        color: day.color,
      })),
    });
    if (!snapshot.success) {
      throw new GitMosaicError(
        "INVALID_PROJECT",
        "GitHub returned an invalid contribution calendar",
        {
          cause: snapshot.error,
        },
      );
    }
    return snapshot.data;
  }
}
