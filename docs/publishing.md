# Publishing and reverting

Publishing is the only part of `git-mosaic` that reaches the network. Every
other command — designing, previewing, planning, applying — is local. This page
describes exactly what a push does, and exactly how to undo it.

> [!IMPORTANT]
> Pushed commits are contribution artwork. They do not represent development
> activity. Disclose that in the repository you publish. See the disclosure
> template in the [README](../README.md).

## What has to be true before contributions appear

A commit only lights up the GitHub contribution graph when **all** of these
hold. `git-mosaic` controls the first two; the rest are yours.

| Requirement                                                     | Who controls it |
| --------------------------------------------------------------- | --------------- |
| The commit exists with the right author date                    | `gm apply`      |
| The commit is pushed to GitHub                                  | `gm publish`    |
| The author email is a **verified email on your GitHub account** | you             |
| The repository is not a fork                                    | you             |
| The commits are on the **default branch** (or `gh-pages`)       | you             |

The most common reason a mosaic never shows up is the third row: the plan was
created with an email that GitHub does not associate with your account. Check
your verified addresses at <https://github.com/settings/emails>, and use one of
them for `--author-email`.

Empty commits (the default) count. You do not need to change any files.

## The five steps

```bash
# 1. Design a project for a span of time.
gm init "hire me" --year 2025

# 2. Draw. Text is stamped straight onto the calendar cells.
gm import text "HIRE ME" --project ./hire-me
gm preview --project ./hire-me

# 3. Plan. Deterministic, checksummed, and it runs no Git commands.
#    --readme commits a README so the repo is not an empty shell.
gm plan --project ./hire-me --repo ./hire-me/repository \
  --author-name "Example User" --author-email "you@example.com" \
  --message-template "art: {project} pixel {date}" --readme

# 4. Apply. Creates local commits. Still nothing has left your machine.
gm apply ./hire-me/plans/latest.json --dry-run --init-repository
gm apply ./hire-me/plans/latest.json --init-repository

# 5. Publish. The only step that touches the network.
gm publish ./hire-me/repository --dry-run
gm publish ./hire-me/repository --create you/hire-me --private
```

`gm publish` always prints what it is about to do and requires you to type
`PUSH` before it pushes. Pass `--yes` only for intentional non-interactive use.

### Publishing options

| Flag                     | Effect                                                     |
| ------------------------ | ---------------------------------------------------------- |
| `--dry-run`              | Report the remote, branch, and commit count. Push nothing. |
| `--create <owner/name>`  | Create the repository with the GitHub CLI (`gh`).          |
| `--private` / `--public` | Visibility for `--create`. **Private is the default.**     |
| `--remote-url <url>`     | Push to a repository you already created yourself.         |
| `--branch <branch>`      | Branch to push. Defaults to `main`.                        |
| `--yes`                  | Skip the typed confirmation.                               |

`--create` requires `gh` to be installed and authenticated (`gh auth login`).
If you would rather not depend on `gh`, create the repository on github.com and
pass `--remote-url` instead.

`gm publish` never force-pushes, never rewrites history, and only ever pushes
the single branch you name.

## Replacing a published mosaic

To change artwork that is already live — fix a typo, redraw it, use different
text — **do not delete the repository**. Deleting costs you the URL and leaves
the contribution graph stale for up to 24 hours, during which a replacement
mosaic renders on top of the ghost of the old one.

Instead, regenerate the history and force-push it over the same repository. The
graph follows whatever commits the repository currently contains, so replacing
them replaces the drawing.

`git-mosaic` will not run the force-push for you: rewriting published history is
destructive and affects anyone who has cloned the repository, so it stays a
deliberate manual act. The four steps are:

```bash
PROJECT=./output/hire-me-2025
REPO=git@github.com:you/hire-me.git

# 1. Redraw. Any import or edit works; this replaces the whole canvas.
gm import text "YO" --project "$PROJECT"

# 2. Discard the previously generated commits. `apply` only ever appends, so it
#    must start from a clean slate rather than stack a second mosaic on top.
rm -rf "$PROJECT/repository"

# 3. Regenerate the history locally.
gm plan --project "$PROJECT" --repo "$PROJECT/repository" \
  --author-name "Example User" --author-email "you@example.com" --readme
gm apply "$PROJECT/plans/latest.json" --init-repository --yes

# 4. Force-push over the existing repository.
cd "$PROJECT/repository"
git remote add origin "$REPO"
git fetch origin                       # required, or --force-with-lease refuses
git push --force-with-lease origin main
```

Step 4 prints `+ f27b915...e80791b main -> main (forced update)`. The old
commits are now unreachable from `main` and the graph re-renders with the new
drawing, usually within minutes — no deletion, no 24-hour ghost window, same
repository URL.

Use `--force-with-lease`, never a bare `--force`: it refuses if someone else has
pushed to the branch since your `git fetch`.

> [!WARNING]
> This rewrites the branch. Only do it on a repository that contains **nothing
> but generated artwork**. If the repository also holds real work, that work is
> destroyed. Check first:
>
> ```bash
> # every commit should carry a Git-Mosaic-Plan trailer
> git log --format='%H %s' --invert-grep --grep='Git-Mosaic-Plan:'
> ```
>
> Any commit listed by that command is **not** artwork and would be lost.

## Reverting

### Before you pushed

Nothing left your machine. Delete the generated repository:

```bash
rm -rf ./hire-me/repository
```

The project, drawing, and plan are untouched. Re-run `gm apply` when ready.

### After you pushed

Pick one.

**Option 1 — delete the repository.** The artwork commits only ever existed in
that repository, so deleting it removes them.

```bash
gh repo delete you/hire-me --yes
```

> [!WARNING]
> The contribution graph does **not** update immediately. GitHub can take up to
> **24 hours** to drop the tiles. Until it does, pushing a replacement mosaic
> will show both drawings layered on top of each other. Wait for the graph to
> go clean before you push a new one.

If the tiles are still there after 24 hours, they will not clear on their own —
this is a known GitHub bug, most often seen after a force-push. Ask GitHub
Support to purge the stale contribution data:
<https://support.github.com/contact?tags=rr-remove-data>

**Do not use deletion to edit a mosaic.** To change artwork that is already
live, keep the repository and replace its history instead (see
[Replacing a published mosaic](#replacing-a-published-mosaic)). Deleting costs
you the URL and a 24-hour ghost window for nothing.

**Option 2 — make it private.** Contributions from private repositories are
still counted for you, but are not visible to others unless you enable private
contributions on your profile. This hides the repository without removing the
graph.

```bash
gh repo edit you/hire-me --visibility private
```

**Option 3 — remove the commits but keep the repository.** Only useful when you
pushed artwork into a repository you also use for real work.

```bash
cd ./hire-me/repository

# Inspect what git-mosaic created. Every generated commit carries trailers.
git log --format='%H %s' --grep='Git-Mosaic-Plan:'

# Reset the branch to the last commit before the artwork, then force-push.
git reset --hard <sha-before-the-artwork>
git push --force-with-lease origin main
```

`git-mosaic` will not run that force-push for you. Rewriting published history
is destructive and affects anyone who has cloned the repository, so it stays a
deliberate manual act.

Every generated commit carries `Git-Mosaic-Plan`, `Git-Mosaic-Step`, and
`Git-Mosaic-Date` trailers, which is what makes artwork commits identifiable
after the fact.

### The graph did not update

GitHub recalculates the contribution graph asynchronously. Give it a few
minutes. If it still has not appeared, the cause is almost always one of:

- the author email is not verified on your account (see the table above);
- the commits are not on the default branch;
- the repository is a fork;
- the dates are in the future — GitHub shows them when the dates arrive.
