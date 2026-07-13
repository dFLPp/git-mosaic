# Security policy

## Supported versions

Before the first stable release, security fixes are made on the current main
development line only. Published support ranges will be listed here when public
release artifacts exist.

| Version                  | Supported             |
| ------------------------ | --------------------- |
| current development line | yes                   |
| older snapshots/forks    | no guaranteed support |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use this repository's **Security** tab to submit a private vulnerability report
or draft security advisory when that feature is available. Include:

- affected version or commit;
- operating system, Node version, and Git version;
- a minimal proof of concept;
- likely impact and prerequisites;
- whether a token, repository, path, or generated history may have been exposed.

If private reporting is unavailable, contact a repository maintainer through a
trusted private channel and ask for a secure reporting route without sending the
exploit or secret in the first message. Never paste a token into a public issue,
discussion, log, or chat.

Maintainers should acknowledge a complete report as soon as practical, confirm
the supported impact, coordinate a fix and disclosure date, and credit the
reporter unless anonymity is requested. There is no bug-bounty promise.

## Security-sensitive surfaces

Reports are especially useful for:

- execution of unexpected Git commands or automatic network publication;
- repository writes during preview, plan, inspect, or dry-run;
- path traversal or writes outside the selected project/repository;
- bypasses of repository authorization, clean-tree, branch, or base checks;
- plan checksum/canonicalization bypasses;
- unsafe resume that duplicates, skips, or misidentifies commits;
- GitHub token persistence or disclosure in output, plans, snapshots, logs, or
  exceptions;
- command/argument injection through paths, identities, templates, or messages;
- destructive history rewriting or deletion of user data.

## Token and repository hygiene

GitHub tokens should be supplied through `GITHUB_TOKEN` or `--token-stdin`,
scoped as narrowly as GitHub permits, and revoked immediately if exposed.
`git-mosaic` is designed not to persist tokens and never pushes automatically.

Before applying a plan, review the absolute target path and use `--dry-run`.
Keep backups for repositories that matter. The clean-tree check is a guard, not
a substitute for a backup or repository access controls.

## Scope boundaries

The following are documented product limitations rather than vulnerabilities by
themselves:

- GitHub rendering colors differently from the local quartile estimate;
- GitHub declining to count commits that do not meet its account/repository
  contribution rules;
- a user explicitly confirming and applying an accurately displayed plan;
- a user manually pushing generated commits after application;
- disclosure implications inherent in intentionally generated artificial
  history.
