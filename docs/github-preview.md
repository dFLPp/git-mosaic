# GitHub preview and tokens

GitHub integration is optional. A project can be imported, previewed, planned,
and applied entirely offline. The integration adds an observed contribution
calendar so planned commits can be previewed on top of activity that already
exists.

## Importing a snapshot

Create a token that can query the authenticated GitHub GraphQL API, then choose
one of these input methods:

```bash
GITHUB_TOKEN=... gm github import --username USER --project ./art
```

```bash
printf '%s' "$GITHUB_TOKEN" | \
  gm github import --username USER --project ./art --token-stdin
```

The token is held in memory for the request. It is not included in the GraphQL
snapshot, `mosaic.json`, plans, logs, or commits. Avoid putting a literal token
in shell history; an environment variable or secret manager is safer. Do not
redirect token input into a project file.

The request covers exactly the project's inclusive period. On success,
`snapshot.github.json` is written beside `mosaic.json`, and the same validated
snapshot is embedded into the project. Subsequent preview and plan commands use
the stored data without contacting GitHub.

There is no automatic retry. Authentication/API failures use `GM011`; rate
limits use `GM012`. An existing snapshot remains useful when offline or rate
limited.

## Observed, mixed, and estimated output

- `OBSERVED`: GitHub supplied the day and the mosaic adds no commits. Its
  contribution level and optional color are retained.
- `MIXED`: GitHub supplied the day and the mosaic adds commits. The combined
  count is assigned an estimated quartile.
- `ESTIMATED`: no matching observed day exists. The level comes entirely from
  the local estimate.

Every terminal and SVG preview warns that colors are estimates. A snapshot is a
point-in-time observation: later activity can change GitHub's quartiles and
colors even if the plan is unchanged.

## When GitHub counts a commit

Creating a correctly dated local commit is not sufficient by itself. GitHub's
profile contribution rules apply. In particular, use an author email associated
with the intended GitHub account; contributions generally need to reach the
repository's default branch (or `gh-pages`), and fork activity is treated
differently. Repository visibility and account settings also affect what is
shown.

Review GitHub's current official
[profile contribution reference](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference)
before publishing. `git-mosaic` neither verifies these account/repository rules
nor pushes the commits.

## Rotating or removing a token

If a token may have leaked, revoke it in GitHub immediately and inspect shell
history, CI logs, and redirected files. Removing `snapshot.github.json` does not
remove the embedded `existingContributions` object from `mosaic.json`; edit or
recreate the project if the snapshot itself must be removed.
