# Strip CI and branded release implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add contributor CI, synchronized `0.4.0` versioning, reproducible Strip branding assets, and custom cross-platform Electron/CLI release workflows.

**Architecture:** Keep `electron-vite` responsible for application bundles, `electron-builder` responsible for platform installers, and PyInstaller responsible for standalone CLI executables. A root `VERSION` file is the single source of truth; a Python synchronization/validation script updates the existing Python and Electron metadata surfaces. A checked-in asset generator derives all installer artwork from `assets/strip-logo.png`, while GitHub Actions separates read-only CI from tag-triggered release publishing.

**Tech Stack:** GitHub Actions, Python `unittest`, Pillow, PyInstaller, Node built-in test runner, electron-vite, electron-builder, NSIS, DMG configuration, AppImage, Debian packaging.

**Spec:** `docs/superpowers/specs/2026-09-29-strip-ci-and-branded-release-design.md`

## Global Constraints

- Use `electron-builder` for Electron packaging and PyInstaller for the standalone CLI.
- Use one shared version for the CLI and reader; the first release produced by this design is `0.4.0`.
- Run CI on every branch push, every pull request, and manual workflow dispatch.
- Publish separate CLI and reader artifacts with OS, architecture, version, and checksums.
- Do not request or modify the user's comic download directory during installation.
- Do not include Electron logos or generic Electron copy in source assets, generated artifacts, installer metadata, or release-facing copy.
- Keep unrelated local files, including the existing untracked planning documents, out of implementation commits.

## Review Focus

- A mismatched release tag must fail before any artifact is uploaded; Task 1 tests tag/version validation.
- A missing or wrong-size generated icon must fail packaging rather than falling back to Electron artwork; Task 2 tests the asset manifest and packaging configuration.
- A parser added to the registry must be present in the packaged CLI; Task 3 tests the PyInstaller hidden-import manifest.
- A release artifact must not claim an architecture different from the runner/build target; Task 5 tests artifact naming and matrix metadata.
- CI must not need release credentials or library-directory state; Task 4 tests workflow permissions and Task 6 documents the boundary.

---

### Task 1: Establish synchronized versioning and release metadata

**Files:**
- Create: `VERSION`
- Create: `scripts/sync_version.py`
- Create: `core/tests/test_release_version.py`
- Modify: `core/setup.py`
- Modify: `core/strip/__init__.py`
- Modify: `desktop/package.json`
- Modify: `desktop/package-lock.json`
- Modify: `desktop/test/version.test.cjs`

**Interfaces:**
- Produces `VERSION` containing `0.4.0` and a script interface `python scripts/sync_version.py [--check] [--version VERSION]`.
- `--check` exits nonzero and identifies every stale version surface; the release workflow consumes this check.

- [ ] **Step 1: Write the failing version tests**

  Add tests that assert the root version is `0.4.0`, Python runtime/package metadata match it, Electron package and lockfile metadata match it, and stale metadata is reported by `--check`.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run from `core/`: `python -m unittest discover -s tests -p 'test_release_version.py'`

  Expected: FAIL because the root version source and synchronization interface do not exist.

- [ ] **Step 3: Implement the version source and synchronization script**

  Parse the root `VERSION`, update only the known metadata fields, support `--check` without mutation, and reject non-semver values. Set all current surfaces to `0.4.0`.

- [ ] **Step 4: Run the focused and existing version tests**

  Run from `core/`: `python -m unittest discover -s tests -p 'test_release_version.py'`; then run `python -m unittest discover -s tests -p 'test_version.py'`.

  Expected: PASS with all version assertions green.

- [ ] **Step 5: Commit**

  ```bash
  git add VERSION scripts/sync_version.py core/setup.py core/strip/__init__.py desktop/package.json desktop/package-lock.json core/tests/test_release_version.py desktop/test/version.test.cjs
  git commit -m "chore: synchronize release version metadata"
  ```

### Task 2: Generate and validate the Strip branding asset set

**Files:**
- Create: `scripts/generate_release_assets.py`
- Create: `scripts/verify_release_assets.py`
- Create: `scripts/tests/test_release_assets.py`
- Create: `desktop/installer/assets/README.md`
- Create: generated `desktop/installer/assets/icons/*.png`
- Create: generated `desktop/installer/assets/strip.ico`
- Create: generated `desktop/installer/assets/strip.icns`
- Create: generated Windows and macOS installer artwork under `desktop/installer/assets/`
- Modify: `desktop/package.json`

**Interfaces:**
- `python scripts/generate_release_assets.py` derives all outputs from `assets/strip-logo.png`.
- `python scripts/verify_release_assets.py` exits nonzero with a specific missing, malformed, or wrong-dimension asset.
- `desktop/package.json` points electron-builder at the generated platform assets and never at a missing generic `icon` path.

- [ ] **Step 1: Write failing asset-manifest tests**

  Assert the required Linux sizes are 16, 24, 32, 48, 64, 128, 256, 512, and 1024; the Windows icon contains multiple sizes; the macOS icon exists; the Windows sidebar/header dimensions are 164x314 and 150x57; and the package configuration references only generated Strip assets.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run from the repository root: `python -m unittest discover -s scripts/tests -p 'test_release_assets.py'`

  Expected: FAIL because the generated asset directory and verifier do not exist.

- [ ] **Step 3: Implement the generator and verifier**

  Use the canonical 1254x1254 Strip PNG as input, generate deterministic RGBA outputs, create multi-size ICO/ICNS assets through a reproducible conversion path, and validate dimensions, formats, and file existence. Generate installer artwork from the existing parchment/ocean-steel visual language.

- [ ] **Step 4: Configure electron-builder asset references**

  Update `desktop/package.json` so Windows, macOS, and Linux targets use the generated assets and the Linux configuration includes both `AppImage` and `deb`.

- [ ] **Step 5: Run asset tests and the verifier**

  Run from the repository root: `python -m unittest discover -s scripts/tests -p 'test_release_assets.py'`

  Expected: PASS with every required generated asset validated.

- [ ] **Step 6: Commit**

  ```bash
  git add scripts/generate_release_assets.py scripts/verify_release_assets.py scripts/tests/test_release_assets.py desktop/installer desktop/package.json
  git commit -m "feat: add branded release assets"
  ```

### Task 3: Apply runtime branding and complete CLI bundling

**Files:**
- Create: `desktop/test/branding.test.cjs`
- Modify: `desktop/main/preload.js`
- Modify: `desktop/main/index.js`
- Modify: `desktop/renderer/src/views/SettingsView.jsx`
- Modify: `desktop/renderer/src/styles/main.css`
- Modify: `build_cli.py`
- Modify: `core/tests/test_release_version.py`

**Interfaces:**
- The preload API exposes a read-only `app.version()` value backed by Electron's `app.getVersion()`.
- `SettingsView` renders the runtime version and Strip logo in the About card.
- The PyInstaller command enumerates every registered parser hidden import required by the packaged executable.

- [ ] **Step 1: Write failing runtime-branding and CLI-manifest tests**

  Assert that the preload exposes only the version accessor needed by the renderer, the About view does not contain a stale literal version, the Strip logo is rendered, and `build_cli.py` lists every registered parser module.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run from `desktop/`: `npm test -- test/branding.test.cjs`; then run from `core/`: `python -m unittest discover -s tests -p 'test_release_version.py'`.

  Expected: FAIL because the current About view is hardcoded to `0.3.1` and the CLI build manifest omits newer parsers.

- [ ] **Step 3: Implement runtime version and About branding**

  Add the narrow preload accessor, render its resolved value in the About view, use the canonical Strip logo, and add only the CSS needed to keep the card aligned with the existing design system.

- [ ] **Step 4: Complete the PyInstaller parser manifest**

  Add hidden imports for Webtoons, WeebCentral, Comix, Asura Scans, and MangaKakalot, keeping the existing bundled-resource copy behavior intact.

- [ ] **Step 5: Run focused and full application tests**

  Run: `npm test` from `desktop` and `python -m unittest discover -s tests -p 'test_*.py'` from `core`.

  Expected: PASS with the runtime branding, version, parser, and existing regression tests green.

- [ ] **Step 6: Commit**

  ```bash
  git add desktop/main/preload.js desktop/main/index.js desktop/renderer/src/views/SettingsView.jsx desktop/renderer/src/styles/main.css desktop/test/branding.test.cjs build_cli.py core/tests/test_release_version.py
  git commit -m "feat: apply Strip branding to the reader"
  ```

### Task 4: Add contributor CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/scripts/verify_workflow_config.py`
- Create: `.github/tests/test_ci_workflow.py`
- Modify: `CONTRIBUTING.md`
- Modify: `README.md`

**Interfaces:**
- `ci.yml` runs on push, pull request, and manual dispatch with read-only permissions.
- The workflow installs from `core/requirements.txt` and `desktop/package-lock.json`, invokes the existing test/build commands, runs the asset verifier, and performs a CLI packaging smoke build.

- [ ] **Step 1: Write failing workflow-contract tests**

  Assert the workflow triggers the three required event types, has no write permission, invokes the core and desktop suites, runs `electron-vite build`, runs the asset verifier, and does not reference a library path or release token.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run from the repository root: `python -m unittest discover -s .github/tests -p 'test_ci_workflow.py'`

  Expected: FAIL because the workflow and verifier do not exist.

- [ ] **Step 3: Implement the CI workflow and contract verifier**

  Use a matrix covering Windows, macOS, and Ubuntu, install the project dependencies explicitly, run the existing commands, and keep all permissions read-only. Use the repository's current Python and Node test entry points rather than introducing a second test framework.

- [ ] **Step 4: Document contributor checks**

  Add the local equivalents and workflow status to `CONTRIBUTING.md` and update the README's supported-sites table with MangaKakalot while touching release documentation.

- [ ] **Step 5: Run workflow-contract tests and local checks**

  Run from the repository root: `python -m unittest discover -s .github/tests -p 'test_ci_workflow.py'`

  Expected: PASS with the workflow contract validated.

- [ ] **Step 6: Commit**

  ```bash
  git add .github/workflows/ci.yml .github/scripts/verify_workflow_config.py .github/tests/test_ci_workflow.py CONTRIBUTING.md README.md
  git commit -m "ci: add contributor test workflow"
  ```

### Task 5: Add tag-based cross-platform release workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `.github/scripts/verify_release_tag.py`
- Create: `.github/scripts/package_cli.py`
- Create: `.github/tests/test_release_workflow.py`
- Modify: `desktop/package.json`
- Modify: `build_cli.py`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- `release.yml` consumes a validated `vMAJOR.MINOR.PATCH` tag and the generated asset set, then publishes CLI and reader artifacts plus checksums.
- `verify_release_tag.py` accepts a tag and project version and exits nonzero on mismatch.
- `package_cli.py` wraps the platform-specific PyInstaller output into the versioned standalone CLI artifact name.

- [ ] **Step 1: Write failing release-contract tests**

  Assert the release workflow triggers only on version tags/manual dispatch, requests `contents: write` only in the publishing job, invokes platform-specific electron-builder targets, builds both Linux targets, runs tag validation, emits checksums, and uses version/OS/architecture artifact names.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run from the repository root: `python -m unittest discover -s .github/tests -p 'test_release_workflow.py'`

  Expected: FAIL because the release workflow, tag validator, and CLI artifact wrapper do not exist.

- [ ] **Step 3: Implement release validation and artifact naming**

  Validate the tag against `VERSION`, derive the actual runner architecture, package the PyInstaller output without relabeling it, and generate SHA-256 checksums for every artifact.

- [ ] **Step 4: Implement the release matrix and publishing job**

  Build Windows NSIS, macOS DMG, Linux AppImage, and Linux `.deb` through `electron-builder`; build standalone CLI artifacts on compatible runners; upload artifacts between jobs; and create/update the GitHub Release only after all matrix jobs pass.

- [ ] **Step 5: Run release-contract tests and local package builds**

  Run from the repository root: `python -m unittest discover -s .github/tests -p 'test_release_workflow.py'` and `python scripts/verify_release_assets.py`; then run `npm run build` from `desktop`.

  Expected: PASS for the workflow contract and local Electron bundle; platform installers are validated by their native GitHub runners.

- [ ] **Step 6: Commit**

  ```bash
  git add .github/workflows/release.yml .github/scripts/verify_release_tag.py .github/scripts/package_cli.py .github/tests/test_release_workflow.py desktop/package.json build_cli.py CONTRIBUTING.md
  git commit -m "ci: add branded cross-platform release workflow"
  ```

### Task 6: Final verification and release documentation

**Files:**
- Modify: `CONTRIBUTING.md`
- Modify: `README.md`
- Test: all core, desktop, workflow-contract, asset, and version tests

- [ ] **Step 1: Run the complete local verification pass**

  Run:

  ```bash
  python -m unittest discover -s tests -p 'test_*.py'
  python scripts/verify_release_assets.py
  python -m unittest discover -s .github/tests -p 'test_*workflow.py'
  npm test
  npm run build
  ```

  Expected: all tests pass and the Electron production bundle succeeds.

- [ ] **Step 2: Review generated files and default-branding references**

  Search release inputs for `electron` default artwork and confirm every packaged icon reference resolves to a Strip asset. Inspect the generated asset dimensions and packaging metadata.

- [ ] **Step 3: Update the release runbook**

  Document local asset generation, version synchronization, CI behavior, tag creation, release artifact names, and the fact that the download directory is configured only inside the app.

- [ ] **Step 4: Commit**

  ```bash
  git add CONTRIBUTING.md README.md
  git commit -m "docs: document CI and release process"
  ```

- [ ] **Step 5: Push all implementation commits to `dev`**

  ```bash
  git push origin dev
  ```

  Expected: `origin/dev` points at the final verified commit; unrelated pre-existing untracked planning documents remain uncommitted.
