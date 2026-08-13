# Contributing to NerdTorrentPlayer

Thanks for helping improve NerdTorrentPlayer. Small, focused pull requests are
the easiest to review and the most likely to ship quickly.

## Before You Start

1. Read the [README](README.md) and the [native bridge guide](backend/bridge/README.md).
2. Search open issues and pull requests before starting duplicate work.
3. Open an issue first for a new feature, broad UI redesign, or transport change.
4. Do not report security vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).

## Local Setup

```bash
git clone https://github.com/GautamVhavle/NerdTorrentPlayer.git
cd NerdTorrentPlayer
npm install
npm run dev
```

The hybrid development command starts the browser app and the loopback bridge.
Use `npm run dev:web` when working only on browser WebTorrent behavior.

## Development Guidelines

- Keep changes scoped to the user-visible behavior or the owning module.
- Preserve the browser/native split. Do not make the hosted app probe arbitrary
  loopback hosts or assume conventional BitTorrent is available in a browser.
- Do not expose bridge bootstrap tokens, session tokens, signed stream URLs, or
  raw private torrent sources in logs, telemetry, screenshots, or documentation.
- Keep the local bridge loopback-only and retain host/origin/session-token checks.
- Use existing player, store, and UI patterns before adding new abstractions.
- Make desktop and mobile layouts work together. Check narrow viewports when
  changing the player, file manifest, dialogs, or inspector panels.
- Use ASCII punctuation in project text unless a domain term requires Unicode.

## Validation

Run the narrowest relevant check while iterating, then run the broader checks
for cross-cutting changes:

```bash
npm run lint
npm run test:bridge
npm run build:vercel
```

Use `npm run test:live-torrent` only when network access is available. It makes
a real request to the public-domain Sintel torrent.

For bridge or HLS changes, include a test in `tests/bridge.test.mjs`. For UI
metadata or server rendering changes, update `tests/rendered-html.test.mjs`.

## Pull Requests

Include:

- A concise problem statement and implementation summary.
- Validation commands you ran and their results.
- Screenshots for visual changes at desktop and mobile widths.
- Any known transport limitation or unsupported torrent case.

Avoid unrelated formatting, generated-file churn, and drive-by refactors. Keep
one behavior change per pull request where practical.

## Commit Messages

Use a short imperative summary that describes the outcome, for example:

```text
Improve HLS segment retention
Add mobile next-episode control
Document bridge security model
```