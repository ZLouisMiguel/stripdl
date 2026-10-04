# Strip CI and branded release design

## Goal

Establish a contributor-facing GitHub Actions pipeline and a repeatable `0.4.0` release pipeline that publishes the standalone `stripdl` CLI and a fully branded Strip Reader installer for Windows, macOS, and Linux. The release must use `electron-builder`, must use Strip artwork throughout the application and installer surfaces, and must never ship Electron's default branding.

## Scope and behavior

### Continuous integration

- Run CI on every branch push, every pull request, and manual workflow dispatch.
- Install the Python CLI dependencies and run the complete Python test suite.
- Install the Electron dependencies with the lockfile and run the complete Node test suite.
- Run the Electron production bundle build.
- Run a PyInstaller smoke build so the bundled CLI path is exercised before release work begins.
- Validate that the release configuration references existing Strip assets and does not reference Electron default artwork.
- Keep CI read-only: it tests and builds artifacts but does not publish releases.

### Shared versioning

- Use a single root version source for the CLI and reader; the first release produced by this design is `0.4.0`.
- Synchronize the version into Python package metadata, the Python runtime version, Electron package metadata, the lockfile, and the About dialog.
- Validate that a release tag has the same semantic version as the synchronized project version.
- Keep the CLI and reader as separate release artifacts while keeping their version numbers aligned.

### Release workflow

- Run only for version tags matching `vMAJOR.MINOR.PATCH` and through an explicit manual dispatch that names a version.
- Build the CLI and Electron reader independently, then attach both artifact families to one GitHub Release.
- Publish versioned artifacts for each supported operating-system and architecture target; never publish an artifact under a misleading architecture name.
- Use native runners where required by PyInstaller or platform packaging. If a requested target cannot be built reliably on the available runner, fail the release rather than silently producing a mislabeled artifact.
- Give the release workflow `contents: write` only for the publishing job; CI jobs remain read-only.

### Canonical Strip branding

- Treat `assets/strip-logo.png` as the canonical source artwork.
- Generate the required Windows `.ico`, macOS `.icns`, and Linux PNG sizes from that source through a checked-in, reproducible asset-generation utility.
- Generate installer artwork from the same palette and logo family rather than introducing unrelated artwork.
- Validate the generated dimensions and file formats in CI before packaging.
- Use the Strip logo for the installed application, desktop shortcuts, Start Menu or Applications entries, taskbar or dock metadata, About UI, installer surfaces, and the Windows uninstaller.
- Do not include Electron logos or generic Electron copy in source assets, generated artifacts, installer metadata, or release-facing copy.

### Windows installer

- Continue using `electron-builder` with an NSIS target.
- Configure per-user installation by default while allowing the user to choose another installation directory.
- Supply a Strip multi-size icon, a 164x314 sidebar, a 150x57 header, and an uninstaller sidebar.
- Use an NSIS include file for Strip-specific welcome, finish, and uninstall copy, with optional custom pages only when they serve installation clarity.
- Create Strip-branded desktop and Start Menu shortcuts and keep the uninstaller branded.
- Do not ask for the comic download directory during installation; that remains an in-app setting.

### macOS installer

- Continue using `electron-builder` with a DMG target.
- Supply a Strip `.icns` application and volume icon.
- Configure a branded DMG background, window size, and icon positions through `dmg.contents`.
- Preserve the normal drag-to-Applications flow and avoid adding an installer-time library-directory prompt.

### Linux packages

- Build both AppImage and `.deb` packages with `electron-builder`.
- Supply the generated Strip PNG icon set and a correct `.desktop` entry.
- Set the product name, description, categories, executable name, and desktop integration metadata to Strip values.
- Ensure the application appears correctly in supported desktop application menus without requiring a custom download directory.

### Application branding and version display

- Replace the hardcoded reader version in the About view with the synchronized runtime version.
- Show the Strip logo in the About view using the same asset family as the packaged application.
- Keep the existing Strip visual language: parchment neutrals, ocean-steel accent, DM Serif Display headings, DM Sans body text, existing spacing, and existing rounded/shadow treatment.
- Ensure the Electron main process, renderer, packaged application metadata, and installer all use the same product name and icon.

### CLI bundling

- Keep PyInstaller as the standalone CLI bundler.
- Ensure the bundled executable includes every registered parser, including Webtoons, WeebCentral, Comix, Asura Scans, and MangaKakalot.
- Copy the platform-specific CLI executable into the Electron `extraResources` location for the reader package.
- Publish the standalone CLI separately so users can use it without installing the reader.

## Release artifact naming

Artifacts must include the product, version, operating system, and architecture. The exact extension follows the platform, for example:

```text
stripdl-0.4.0-windows-x64.exe
stripdl-0.4.0-linux-x64.tar.gz
stripdl-0.4.0-macos-arm64.tar.gz
Strip-0.4.0-windows-x64.exe
Strip-0.4.0-macos-arm64.dmg
Strip-0.4.0-linux-x64.AppImage
Strip-0.4.0-linux-x64.deb
```

The release workflow must use the actual build architecture in each filename and must attach checksums for published artifacts.

## Acceptance criteria

1. A push to any branch and every pull request runs the Python suite, Electron suite, Electron production build, and CLI packaging smoke test.
2. CI passes without requiring release credentials or access to the comic download directory.
3. A tag such as `v0.4.0` is rejected when it does not match the synchronized project version.
4. A successful release publishes separate CLI and reader artifacts for each supported OS and architecture target, plus checksums.
5. Windows installs per-user by default, permits an alternate install directory, creates branded shortcuts, and shows Strip artwork in the installer and uninstaller.
6. macOS produces a branded DMG with Strip artwork, volume icon, and drag-to-Applications layout.
7. Linux produces both AppImage and `.deb` packages with correct Strip desktop integration.
8. All packaged application and installer icons resolve to generated Strip assets; no Electron default icon or copy appears in the generated package inputs or outputs.
9. The About view displays the synchronized release version and Strip logo.
10. The bundled CLI contains all registered parsers and the standalone CLI artifacts are independently runnable on their target platforms.
11. The release process does not request or modify the user's comic download directory.

## Delivery constraints

- Use `electron-builder` for Electron packaging and PyInstaller for the standalone CLI.
- Preserve the existing Electron architecture and preload boundary; do not broaden renderer filesystem access to support packaging.
- Keep CI and release workflows declarative and reproducible; do not depend on a developer machine's globally installed tools.
- Keep generated assets derived from the canonical Strip logo and validate them before use.
- Keep unrelated local files, including the existing untracked planning documents, out of implementation commits.
- Update release documentation and contributor instructions with the exact local and CI commands after the workflows are implemented.

## Known design risks

- Platform-specific icon conversion tools may not be available on every runner. The generator must either use a reproducible cross-platform converter or run the platform-native conversion only on the matching release job and fail clearly when it cannot produce a required format.
- PyInstaller executables are platform-specific. The release matrix must build the CLI on a compatible runner rather than copying one platform's executable into another platform's reader package.
- NSIS and DMG customization surfaces differ substantially. Installer visual consistency comes from shared assets, product copy, colors, and spacing rather than forcing identical layouts across platforms.
- GitHub-hosted runner availability for every architecture may change. The workflow must declare the supported matrix explicitly and fail closed for unavailable targets instead of producing incomplete releases.
