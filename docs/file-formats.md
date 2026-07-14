# File formats

All persistent JSON formats are UTF-8, currently use `schemaVersion: 1`, and are
validated on read. Unknown future schema versions are not silently accepted.

## Project directory

`init` creates:

```text
art/
├── mosaic.json
├── exports/
└── plans/
```

SVG previews are usually placed under `exports/`, and the default plan path is
`plans/latest.json`.

## `mosaic.json`

Representative shape (timestamps and width abbreviated):

```json
{
  "schemaVersion": 1,
  "name": "art",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-01T00:00:00.000Z",
  "period": { "from": "2025-01-01", "to": "2025-12-31" },
  "timezone": "UTC",
  "weekStartsOn": 0,
  "dimensions": { "rows": 7, "columns": 53 },
  "source": { "type": "empty" },
  "intensityMap": [[0], [0], [0], [0], [0], [0], [0]],
  "commitLevelMap": { "0": 0, "1": 1, "2": 4, "3": 10, "4": 20 }
}
```

The sample intensity rows are abbreviated and would fail for a 53-column
project. In a real file every row length must equal `dimensions.columns`, the
dimensions must match the recomputed period, and out-of-range cells must be
zero. `weekStartsOn` is currently always `0` (Sunday).

`source` is one of:

```json
{ "type": "empty" }
{ "type": "matrix", "path": "../input.json" }
{
  "type": "text",
  "content": "Loading...",
  "font": "5x7",
  "align": "center"
}
```

Text `font` records the selected `5x7`, `4x5`, or `3x5` tier; `align` is `left`,
`center`, or `right`.

## Import fit reports

Text imports return a fit report alongside the updated project. The report is
an API/command result and is not stored in `mosaic.json`:

```json
{
  "verdict": "degraded",
  "score": 0.6,
  "signals": {
    "fontTier": "3x5",
    "columnsUsed": 49,
    "columnsAvailable": 51
  },
  "survives": ["every character at the 3x5 pixel font"],
  "lost": ["stroke detail: 3x5 is the legibility floor"],
  "remedies": ["shorten the text to use a larger font tier"]
}
```

`verdict` is `good` or `degraded`, and `score` is in `0..1`.

An optional `existingContributions` contains the validated GitHub snapshot. An
optional free-form `metadata` object is reserved for non-domain metadata.

## Matrix import

A matrix file is a bare JSON array with seven row arrays and no wrapper:

```json
[
  [0, 0, 1, 4],
  [0, 1, 2, 4],
  [0, 2, 3, 4],
  [0, 3, 4, 3],
  [0, 2, 3, 2],
  [0, 1, 2, 1],
  [0, 0, 1, 0]
]
```

Values must be integers `0`, `1`, `2`, `3`, or `4`. The example is only valid
for a four-column project whose out-of-range positions are already zero. Import
is rejected without updating the project if dimensions or values are invalid.

## GitHub snapshot

`snapshot.github.json` has this shape:

```json
{
  "schemaVersion": 1,
  "username": "octocat",
  "period": { "from": "2025-01-01", "to": "2025-12-31" },
  "fetchedAt": "2026-01-02T03:04:05.000Z",
  "days": [
    {
      "date": "2025-01-01",
      "contributionCount": 3,
      "contributionLevel": "SECOND_QUARTILE",
      "color": "#40c463"
    }
  ]
}
```

Levels are `NONE`, `FIRST_QUARTILE`, `SECOND_QUARTILE`, `THIRD_QUARTILE`, or
`FOURTH_QUARTILE`. `color` is optional. Tokens are never part of this format.

## Commit plan

A plan freezes:

- project name, timezone, generation time, repository path/mode/branch/base;
- author and committer identity;
- commit mode, optional file path, level map, and message template;
- totals and every active day;
- every commit's one-based index, timestamp, and message;
- a 16-character `planId` and 64-character SHA-256 `checksum`.

`days[].existingCount`, `commitsToCreate`, `expectedFinalCount`, and
`expectedLevel` make the preview assumption inspectable. The plan only contains
active days, and each active day contains one or more commits.

The checksum is calculated over canonicalized plan content after excluding
`generatedAt`, `planId`, and `checksum`; keys are sorted recursively. `planId` is
the first 16 hexadecimal checksum characters. Editing any protected field makes
`plan inspect` and `apply` fail with `GM013`.

## Apply report and commit trailers

An interrupted CLI apply writes `<plan-path>.apply-report.json`. It records the
plan ID, interruption time, repository/branch, detected state, applied/total
steps, commits created in that invocation, Git version, remotes flag, and safety
warnings. It is a diagnostic report, not resume state: resume is determined by
verifying trailers already in Git history.

The three trailers and their semantics are documented in
[Git generation](git-generation.md).
