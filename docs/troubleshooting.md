# Troubleshooting

The CLI prints expected errors as a stable `GMxxx` code followed by a message
and, when available, a hint.

## Common errors

| Code    | Meaning                                    | What to check                                                                       |
| ------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `GM001` | invalid project/plan structure             | JSON syntax, `mosaic.json`, required plan options, file-mode path                   |
| `GM002` | invalid date range                         | real `YYYY-MM-DD` dates, inclusive order, both custom boundaries                    |
| `GM003` | invalid timezone                           | use an IANA name such as `UTC` or `America/Sao_Paulo`                               |
| `GM004` | invalid intensity map                      | exactly 7 rows, correct column count, values `0..4`, zero out-of-range cells        |
| `GM005` | Git unavailable                            | install Git 2.30+ and ensure `git` is on `PATH`                                     |
| `GM006` | dirty repository                           | inspect and intentionally commit/stash/remove changes; the tool will not clean them |
| `GM007` | repository authorization/invariant failure | mode flags, target path, branch, exact HEAD, confirmation, remotes                  |
| `GM008` | invalid identity                           | non-empty author and committer names and valid email addresses                      |
| `GM009` | plan exceeds safety limits                 | review count; only then consider `--allow-large-plan`                               |
| `GM010` | complete or divergent application          | inspect trailers; do not blindly rerun or rewrite history                           |
| `GM011` | GitHub auth/API failure                    | token, username, permissions, network, API response                                 |
| `GM012` | GitHub rate limit                          | wait for reset or use the existing offline snapshot                                 |
| `GM013` | checksum mismatch                          | restore or regenerate the plan; do not hand-edit it                                 |
| `GM014` | future date                                | choose a past period or intentionally plan with `--allow-future`                    |
| `GM016` | text does not fit                          | compare needed/available columns; shorten the text or split it across projects      |
| `GM017` | unsupported text                           | use A-Z, 0-9, space, or one of `. ! ? - :`                                          |

## Text import is refused

`GM016` includes the exact number of columns needed at the smallest legible
`3x5` font and the number available. Shorten the text or split it across
multiple year projects. `GM017` names the unsupported character; the built-in
fonts support A-Z, 0-9, space, and `. ! ? - :` (lowercase input is uppercased).
The failed import does not modify the project.

## `gm` is not found

`gm` is shorthand used by this documentation, not an installed binary. From a
source checkout run:

```bash
node apps/cli/dist/index.js --help
```

After changing TypeScript source, run `pnpm build` again.

## Plan says zero commits

New projects are blank. Import text or a correctly sized intensity matrix, or
paint cells in the web editor, then preview again. Intensity zero intentionally
produces no commits.

## The matrix width is rejected

Read `dimensions.columns` from the generated `mosaic.json`; every one of the
seven matrix rows must have exactly that many values. Calendar alignment can add
out-of-period cells at either end, and those positions must be zero. See
[Calendar model](calendar-model.md).

## Terminal colors do not appear

ANSI color is only enabled when stdout is a TTY. Redirected output is plain text.
Use SVG export for a portable colored preview. `--no-color` always disables ANSI.

## Dry-run rejects a repository with remotes

This is expected even though no push occurs. Review `git remote -v`, then rerun
with `--allow-repository-with-remotes` if every remote is intentional.

## Existing repository HEAD changed after planning

Regenerate the plan using the new exact `HEAD` rather than bypassing the check.
The base hash protects against applying the same artwork onto an unreviewed
history.

## Apply was interrupted

If the repository is clean and the generated prefix is intact, rerun the exact
same apply command. Resume is automatic. If the repository is dirty, inspect it
first; especially in file mode, an abrupt failure may leave an uncommitted line.
Never discard work until you know whether it belongs to you or the interrupted
operation.

## Plan is reported as divergent or already applied

`complete` plans are deliberately idempotent and cannot be duplicated.
`divergent` means the trailer sequence does not exactly match a contiguous plan
prefix. Inspect without rewriting anything:

```bash
git -C /absolute/repository/path log --format=fuller --grep='Git-Mosaic-Plan:'
```

If history was manually edited, create a fresh project/target or seek help. The
tool does not reset, repair, or force-rewrite a divergent repository.

## GitHub does not show the expected art

Check that the commits were manually pushed, landed on an eligible branch, use
an email associated with the intended account, and satisfy GitHub's current
contribution rules. Then allow GitHub time to update. Even eligible commits may
receive different colors because the local quartiles are estimates.

## Reporting a bug

Include the command shape, `GMxxx` code, Node/Git versions, operating system,
and a minimal redacted project or plan. Remove tokens, personal emails, private
repository paths, and remote URLs. For a suspected vulnerability, follow
[SECURITY.md](../SECURITY.md) instead of opening a public issue.
