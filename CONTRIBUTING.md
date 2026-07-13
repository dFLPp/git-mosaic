# Contributing to git-mosaic

Thank you for helping make contribution artwork safer, more predictable, and
more transparent.

## Before opening a change

- Search existing issues and pull requests.
- For a bug, include a minimal reproduction and the `GMxxx` error code.
- For a new persistent field, CLI behavior, or Git operation, propose the
  compatibility and safety behavior before implementation.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

Never include GitHub tokens, private remote URLs, personal email addresses,
confidential artwork, or an unredacted private plan in an issue or fixture.

## Development setup

Requirements are Node.js 22+, Git 2.30+, and pnpm 11.

```bash
corepack enable
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm format:check
```

Run the local CLI with:

```bash
node apps/cli/dist/index.js --help
```

Tests run from the workspace root with Vitest. Package builds use TypeScript
project references; if a dependent package changed, rebuild the workspace before
testing the CLI manually.

## Repository structure

- `apps/cli`: public command-line interface
- `packages/schemas`: persisted schemas, shared types, and error codes
- `packages/calendar`: date/cell mapping and contribution-level estimates
- `packages/image`: raster import
- `packages/renderer`: terminal and SVG renderers
- `packages/github`: GraphQL provider and snapshots
- `packages/core`: project, preview, import, and planning orchestration
- `packages/git`: repository validation and commit execution
- `docs`: public design and operational documentation

See [Architecture](docs/architecture.md) before moving responsibilities between
packages.

## Change guidelines

### Behavior and tests

- Add or update tests for every behavior change.
- Prefer deterministic fixtures with explicit dates, timezones, identities, and
  generated timestamps.
- Cover leap years, DST-adjacent dates, Unicode, paths with spaces, and failure
  behavior where relevant.
- Tests must not use real tokens or depend on a live GitHub account.
- Git executor tests must use disposable temporary repositories and must never
  push.

### Formats and compatibility

`mosaic.json`, GitHub snapshots, commit plans, apply reports, commit trailers,
and stable error codes are public interfaces. Do not silently change their
meaning. A schema change needs a versioning/migration decision, fixtures, tests,
and an update to [File formats](docs/file-formats.md) and `CHANGELOG.md`.

Changes to plan canonicalization can invalidate checksums and plan IDs. Treat
them as security- and compatibility-sensitive.

### Git safety

Changes under `packages/git` deserve extra review. Preserve these invariants:

- no automatic push, force-push, reset, rebase, amend, or destructive cleanup;
- preview and planning never mutate a Git repository;
- explicit authorization for new, existing, and remote-bearing repositories;
- clean-tree, branch, and expected-base checks;
- deterministic identities/dates and verifiable step trailers;
- safe interruption and idempotent resume.

Add an integration test for every new Git subprocess or validation branch, and
document exactly which repository state it can change.

### Style and commits

Keep changes focused and use existing package boundaries. Run Prettier rather
than hand-formatting around it. Write commit messages that explain the behavior
changed; generated mosaic commits should never be used as project-development
history.

## Pull request checklist

- [ ] Tests cover the change and all local checks pass.
- [ ] No secrets or identifying fixture data were added.
- [ ] Public CLI help and documentation match the implementation.
- [ ] Persistent formats and changelog are updated when applicable.
- [ ] Git/network side effects and failure behavior are explicit.
- [ ] Artificial-history disclosure and color-estimate warnings remain visible.

By participating, you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
