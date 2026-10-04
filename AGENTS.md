# AGENTS.md

This file is the repository-level guide for contributors and coding agents working on
Strip. Read it before changing source code, tests, build configuration, or project
documentation. `CONTRIBUTING.md` contains the longer project-specific reference; this
file defines the current contribution flow. Where its older examples mention branching
from or opening pull requests against `main`, follow this file's `dev` workflow instead.

## Project areas and sources of truth

- `core/` contains the Python `stripdl` CLI, download pipeline, library handling,
  configuration, parsers, and Python tests.
- `desktop/` contains the Electron main/preload process, React renderer, and Node test
  suite.
- GitHub Issues are the source of truth for current bugs, requested features, and
  follow-up work: https://github.com/ZLouisMiguel/stripdl/issues
- `TO_DO.md` and `features.md` are currently personal working notes from manual testing.
  They are not the project backlog or an authoritative feature specification. Do not
  require them to exist, use them to decide scope, or update them in a PR unless the
  task explicitly asks for that.
- `docs/superpowers/` may contain intentionally committed plans/specifications. Do not
  add local planning artifacts there unless the task calls for them.

## Before starting

1. Read this file and the relevant sections of `README.md` and `CONTRIBUTING.md`.
   For issue-backed work, check the relevant GitHub Issue(s) for current requirements
   and acceptance criteria. If no issue exists for a non-trivial change, create one or
   get maintainer direction before implementation. Consult `TO_DO.md` or `features.md`
   only as optional personal context when they are present and relevant.
2. Check the current branch and working tree:

   ```bash
   git branch --show-current
   git status --short
   ```

3. Preserve existing user changes. Do not reset, clean, overwrite, or delete unrelated
   work. If the working tree contains changes that overlap the task, stop and resolve
   the overlap explicitly.
4. Keep fixes and features separate. A bug fix should not quietly include an unrelated
   feature, refactor, generated output, or formatting sweep.

## Branching and contribution flow

For this repository, `dev` is the integration branch and the normal pull-request target.
Do not work directly on `dev` or `main` for normal changes. If a maintainer explicitly
changes the integration target, follow that current repository instruction.

```bash
git switch dev
git pull --ff-only origin dev
git switch -c fix-short-description
# or
git switch -c feature-short-description
```

Use `fix-...` for bug fixes, regressions, reliability work, and corrective
documentation. Use `feature-...` for new user-facing behavior. Use another descriptive
prefix, such as `docs-...` or `chore-...`, when the work is clearly neither a fix nor a
feature. Branch from the latest `dev`, and keep one coherent objective per branch and
pull request.

### Fix workflow

1. Reproduce the problem with the smallest reliable command or test.
2. Trace the failure to its root cause before editing the implementation.
3. Add or update a regression test that demonstrates the failure. Run that test and
   record the failing result before applying the fix when practical.
4. Implement the smallest safe change that fixes the root cause.
5. Run the targeted test, the relevant full suite, and the applicable CLI or desktop
   smoke checks.
6. Update the relevant GitHub Issue and PR description with the verification result,
   remaining limitations, or follow-up work. Do not update the personal note files in a
   code PR unless explicitly requested.

### Feature workflow

1. Confirm the feature is in scope from the relevant GitHub Issue(s), discussion, or
   maintainer request. Treat `TO_DO.md` and `features.md` as optional personal context,
   not as requirements.
2. For multi-step or cross-cutting work, write a short plan/spec before implementation
   and get agreement when the design is not obvious.
3. Add tests for the intended behavior before or alongside the implementation.
4. Implement the smallest complete vertical slice, then verify the affected CLI and/or
   reader behavior end to end.
5. Update public documentation when user-facing behavior changes. Record remaining
   follow-up work in the GitHub Issue or PR; do not update the personal note files by
   default.
6. Do not combine a feature with unrelated bug fixes. If a prerequisite fix is needed,
   land it in a separate fix branch/PR first whenever possible.

## Testing and verification

Run checks from the repository root unless a command says otherwise.

### Core CLI

```bash
python -m unittest discover -s core/tests -t core -v
```

For a core-only change, also run the focused tests and smoke-check the affected command
or parser. The documented CLI commands are `stripdl download`, `stripdl list`,
`stripdl library`, and `stripdl config`; use a safe fixture or a non-mutating command
when live-site access is not required.

### Desktop reader

```bash
npm test --prefix desktop
npm run build --prefix desktop
```

For packaged-app or release changes, also run the relevant asset/build checks described
in `CONTRIBUTING.md`. Do not claim a reader feature is verified from unit tests alone
when it depends on the built renderer or Electron integration.

### General checks

Before committing:

```bash
git diff --check
git status --short
```

Inspect the staged diff and confirm that no secrets, caches, build output, downloads,
screenshots, or editor/agent state were accidentally included. In particular, do not
stage `.superpowers/`, local tool state, `image.png`, `.pytest_cache/`, `node_modules/`,
`desktop/out/`, or release output unless the task explicitly requires that artifact.

## Commits

Use short imperative Conventional Commit-style messages, for example:

- `fix: handle unavailable chapter metadata`
- `feat: add reader page navigation`
- `test: cover library deletion`
- `docs: clarify parser contribution flow`

Keep commits reviewable. Do not amend or rewrite commits that someone else may already
be using, and do not force-push shared branches.

## Pull requests and review

Push the topic branch and open a pull request targeting `dev`:

```bash
git push -u origin fix-short-description
```

Every PR should include:

- a concise summary of the problem or user need;
- the implementation approach and important trade-offs;
- tests and commands run, including results;
- documentation changes when user-facing behavior or setup changes;
- known limitations, live-site dependencies, and follow-up work;
- screenshots or a short recording for meaningful reader UI changes.

Request review before merging. Do not self-merge a change that requires review. Address
review comments with focused follow-up commits, rerun the affected checks, and update
the PR description if the behavior or verification evidence changes. Merge only after
review approval and required CI checks pass. After merge, refresh local `dev` before
starting the next branch.

## Definition of done

A change is ready to hand off when the implementation, tests, documentation, and PR
description agree; targeted and relevant full checks pass; the working tree contains
only intended changes; and any remaining limitation is recorded in the relevant GitHub
Issue or PR rather than being implied or hidden.
