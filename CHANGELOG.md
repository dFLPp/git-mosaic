# Changelog

All notable changes to this project will be documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project intends to follow [Semantic Versioning](https://semver.org/) for public
releases.

## [Unreleased]

### Added

- Public guides for architecture, calendar semantics, GitHub snapshots, Git
  generation/resume, persistent file formats, and troubleshooting.
- Contribution, security, and community conduct policies.

### Changed

- Expanded the README with source installation, an implementation-accurate
  quick start, explicit artificial-history disclosure, preview limitations, and
  repository safety gates.

## [0.1.0] - Unreleased

### Added

- pnpm TypeScript workspace and `git-mosaic` CLI.
- Project initialization for civil-year, rolling-year, and custom periods with
  IANA timezone validation.
- Seven-row Sunday-start calendar model and `0..4` intensity matrices.
- PNG, JPEG, and WebP import with contain/cover/stretch fitting, inversion, and
  contrast control.
- Terminal and SVG previews with light/dark themes, labels, legends, tooltips,
  confidence, and explicit color-estimate warnings.
- Optional GitHub GraphQL contribution snapshot import with environment or stdin
  token input and offline reuse.
- Deterministic commit plans with canonical SHA-256 checksums, plan IDs, plan
  inspection, future-date guards, and commit-count limits.
- Empty and file commit modes with explicit author/committer identity and dated
  timestamps.
- Dry-run, interactive/non-interactive confirmation, repository-mode and remote
  authorization gates, clean-tree/branch/base validation, generated commit
  trailers, partial application reports, and resumable application.
- A strict no-push/no-history-rewrite execution model.
