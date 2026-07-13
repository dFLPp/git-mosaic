# Calendar model

## Periods and alignment

A project period is an inclusive pair of Gregorian ISO dates. `init` accepts one
of three forms:

```bash
gm init art --year 2025 --timezone UTC
gm init art --period rolling-year --timezone America/Los_Angeles
gm init art --from 2025-02-01 --to 2025-05-31 --timezone Europe/Lisbon
```

With no period option, `rolling-year` ending on “today” in the selected timezone
is used. `--year`, `--period`, and `--from/--to` are mutually exclusive, and a
custom range requires both boundaries.

The internal calendar expands the period to complete weeks:

- `alignedFrom` is the Sunday on or before `from`;
- `alignedTo` is the Saturday on or after `to`;
- rows `0..6` are Sunday through Saturday;
- columns advance chronologically by week;
- cells in the aligned rectangle but outside the requested period are
  `OUT_OF_RANGE` and must have intensity zero.

The number of columns follows from the selected dates; the model does not rely
on a fixed width.

## Dates, cells, and timezones

Calendar arithmetic uses the Temporal polyfill and IANA timezone names such as
`UTC`, `America/Sao_Paulo`, or `Asia/Tokyo`. A date maps to:

```text
offset = date - alignedFrom (days)
column = floor(offset / 7)
row = offset modulo 7
```

Each planned commit starts at local noon on its day. Additional commits for the
same cell add one second each. Noon avoids most daylight-saving transition
edges, and the encoded UTC offset makes the timestamp unambiguous. A timezone
therefore affects the definition of today and the offsets in commit timestamps;
changing it changes the plan.

## Intensity and counts

Every in-range cell has an artistic intensity from `0` through `4`. The default
commit-level map is:

| Intensity | Planned commits |
| --------: | --------------: |
|         0 |               0 |
|         1 |               1 |
|         2 |               4 |
|         3 |              10 |
|         4 |              20 |

When a GitHub snapshot is present, the preview calculates:

```text
final count = observed count + planned count
```

The default preview shows the drawn intensity directly: intensity 0 is `NONE`,
1 is `FIRST_QUARTILE`, through 4 as `FOURTH_QUARTILE`. This WYSIWYG view shows
the artwork as authored regardless of the commit-count mapping. The optional
`--estimate` preview sorts positive final counts and classifies them by their
empirical upper rank: up to 25%, 50%, 75%, and 100%. Equal counts receive the
same upper rank. This is a useful local contrast estimate, not GitHub's private
rendering algorithm.

Confidence is `ESTIMATED` without observed data, `OBSERVED` for an unchanged day
from a snapshot, and `MIXED` when an observed day also receives planned commits.
An observed, unchanged day retains the level and optional color returned by
GitHub. Mixed days are re-estimated.

## Matrix orientation

`intensityMap` is row-major: exactly seven arrays, each containing one value per
calendar column. The first array is Sunday, not the first chronological week.
For example, the value at `[2][4]` is Tuesday of week column 4.

See [File formats](file-formats.md) for validation rules and a matrix example.
