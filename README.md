# NerdTorrentPlayer

NerdTorrentPlayer is a dark, browser-only WebTorrent media console built for
people who want both immediate playback and the details behind it. Paste a
magnet or open a `.torrent`, choose a media file, and stream it directly from
WebRTC-compatible peers without uploading the media to an application server.

## Highlights

- Service-worker-backed, seekable WebTorrent streams
- Fast-start WSS tracker discovery with recoverable peer diagnostics
- Ranked media selection and browser codec guidance
- Custom Vidstack player with captions, subtitle sync, PiP, and fullscreen
- Private on-device torrent library and playback resume records
- Live peer, transfer, tracker, and session telemetry
- Responsive keyboard- and touch-friendly retro interface

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Verification

```bash
npm run lint
npx tsc --noEmit
npm test
npm run test:live-torrent
```

The live smoke test fetches the official public-domain Sintel torrent and reads
the first 256 KiB of its MP4 through WebTorrent. It requires network access.

## Browser constraints

Browser WebTorrent can connect only to WebRTC-capable peers through compatible
WebSocket trackers. Media is not transcoded, so playback support still depends
on the browser, container, and codecs. Google Cast is unavailable for the
browser-local service-worker stream; AirPlay is exposed only when the browser
reports it as supported.
