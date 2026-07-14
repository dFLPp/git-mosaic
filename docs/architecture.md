# Architecture

`git-mosaic` separates drawing, simulation, planning, and materialization so the
first three activities cannot accidentally change Git history.

```text
text / matrix / manual painting
            |
            v
project (mosaic.json) --> calendar + estimated preview --> terminal / SVG
      |                            ^
      |                            |
      +-- optional GitHub snapshot+
      |
      v
checksummed commit plan (JSON)
      |
      v
validated, confirmed Git executor --> local commits (never push)
```

## Workspace packages

- `apps/cli` defines the public commands, prompts, flags, and process behavior.
- `apps/web` provides a loopback-only React editor and a session-protected local
  HTTP bridge to the same core operations.
- `packages/schemas` owns versioned Zod schemas, shared types, and stable `GMxxx`
  error codes.
- `packages/calendar` aligns periods to Sunday-start weeks, maps dates and cells,
  generates timestamps, and estimates contribution quartiles.
- `packages/renderer` produces terminal and SVG output without reading files.
- `packages/github` implements the GraphQL provider and snapshot persistence.
- `packages/core` composes projects, imports, previews, GitHub snapshots, and
  deterministic commit plans.
- `packages/git` validates a target repository and materializes or resumes a plan.

Dependencies point inward toward schemas and pure domain functions. The Git and
GitHub side effects are kept behind explicit commands. Preview renderers consume
a calendar model and do not know about the filesystem or Git.

## Persistent boundaries

The project, GitHub snapshot, and commit plan all carry `schemaVersion: 1` and
are validated when read. Writes use a temporary sibling followed by rename to
avoid exposing a partially written JSON or preview file.

A commit plan is derived from project state and execution choices. Canonical
JSON, excluding `generatedAt`, `planId`, and `checksum`, is hashed with SHA-256.
The first 16 hexadecimal characters become the plan ID. Consequently,
regenerating identical plan content produces the same identity even at a
different time.

The project source and the target repository are separate. A project can be
kept, reviewed, and versioned without materializing its plan; a target can be
deleted without losing the artwork source.

## Side-effect boundaries

| Operation            | Project files                  | Network | Git repository             |
| -------------------- | ------------------------------ | ------- | -------------------------- |
| `init`               | creates                        | no      | no                         |
| `import matrix/text` | updates                        | no      | no                         |
| `preview`            | reads; optionally writes SVG   | no      | no                         |
| `github import`      | updates snapshot/project       | yes     | no                         |
| `plan`               | writes plan                    | no      | no                         |
| `plan inspect`       | reads plan                     | no      | no                         |
| `apply --dry-run`    | reads plan/inspects Git        | no      | no writes                  |
| confirmed `apply`    | reads plan                     | no      | creates commits            |
| web editor           | reads/writes through local API | no*     | only after confirmed apply |

`*` The web editor does not require a remote backend. Network access is used
only when a GitHub import is explicitly requested through supported core APIs.

## Error model

Expected failures are `GitMosaicError` values with stable `GMxxx` codes and,
where useful, an actionable hint. Unknown programming or system errors are not
rewritten as successful outcomes. See
[Troubleshooting](troubleshooting.md).
