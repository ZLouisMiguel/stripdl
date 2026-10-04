# stripdl Work Tracker

This file tracks the current state of the v0.4.0 work and the next items to
address.

## Provider support

| Provider | Current state | Notes |
| --- | --- | --- |
| Webtoon | Implemented | Registered parser. |
| WeebCentral | Implemented | Registered parser. |
| Asura Scans | Implemented | Listing works; download output still has an encoding issue. |
| MangaKakalot | Implemented | Registered parser. |
| Comix | Partial | Registered, but currently resolves titles through WeebCentral. |

## Fixes and reliability

### Completed

- Added provider registration for Webtoon, WeebCentral, Comix, Asura Scans,
  and MangaKakalot.
- Added the `stripdl list` flow for displaying series information and chapters.
- Added readable failure messages for list and library operations instead of
  exposing tracebacks.
- Added UTF-8 CLI stream configuration and safe rendering for dynamic metadata
  on Windows consoles.
- Made invalid series metadata non-fatal during library scans.
- Added retry policies for parser/image requests and persisted failed download
  URLs in `.failed-downloads.json` for later retries.

### In progress / partial

- Comix support exists, but it is not independent. `ComixParser` currently
  searches WeebCentral for the matching title. A Comix title that is missing
  from WeebCentral cannot be resolved.
- Asura Scans metadata and chapter listing work, but some author text is
  displayed with broken encoding.

### Outstanding

- Add a user-facing command or UI flow for reviewing and retrying entries from
  `.failed-downloads.json`.

## New features

### Completed

- Added support for the `stripdl list <url>` command.

### Outstanding

- Add a native Comix parser that obtains Comix metadata, chapters, and images
  directly instead of depending on WeebCentral. Keep the WeebCentral bridge
  only as an optional fallback if useful.
- Add `stripdl show providers` to display all available comic and webtoon
  providers instantly.
- Investigate and design an auto-scroll feature.

## Performance

### Outstanding

- Reduce initial loading time to under one second where possible, including
  when the local library contains many downloaded series.
- Identify whether library scanning or another startup task is responsible for
  the current loading delay before optimizing it.

## Notes from v0.4.0 testing

- `stripdl list` successfully returned series information and chapter lists for
  tested Asura Scans URLs.
- Downloading `SSS-Class Suicide Hunter` from Asura Scans failed with the
  Windows `charmap` encoding error above.
- Pasting a Markdown link such as
  `[https://example.com](https://example.com)` into the CLI passes the Markdown
  text as input; commands should receive the raw URL instead.

## Verification audit — 2026-10-04

### Resolved in the current fix pass

- `stripdl --help` no longer crashes on Windows `cp1252` consoles.
- `stripdl library` tolerates invalid or non-UTF-8 series metadata.
- `stripdl list` preserves non-ASCII metadata when the CLI configures UTF-8
  output.

### Coverage gaps

- Add end-to-end desktop tests for the actual React/Electron interactions:
  library loading, opening a series, loading reader pages, deleting a chapter,
  deleting a series, and confirming the resulting UI state.
- Add dedicated Comix parser tests. Current Comix support is only an adapter to
  WeebCentral and has no independent parser behavior to verify.
