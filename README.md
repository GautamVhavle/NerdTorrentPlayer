# NerdTorrentPlayer

NerdTorrentPlayer is a dark, local-first torrent media console built for people
who want both immediate playback and the details behind it. Hosted mode streams
from WebRTC-compatible peers. On localhost, a private native bridge also reaches
conventional UDP/TCP/DHT swarms without uploading media to an application
server.

## Highlights

- Service-worker-backed, seekable WebTorrent streams
- Loopback-only native bridge for UDP trackers, DHT, and TCP peers
- Local HLS remux/conversion for browser-incompatible containers
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

Open `http://localhost:3000`. The development command starts both the web app
and the bridge on `127.0.0.1:41780`. Use `npm run dev:web` for browser-only mode
or `npm run bridge` to run the helper separately.

## Verification

```bash
npm run lint
npx tsc --noEmit
npm test
npm run test:live-torrent
npm run test:bridge
```

The live smoke test fetches the official public-domain Sintel torrent and reads
the first 256 KiB of its MP4 through WebTorrent. It requires network access.

## Transport constraints

Browser WebTorrent can connect only to WebRTC-capable peers through compatible
WebSocket trackers. The localhost bridge is optional, binds only to loopback,
validates the page origin and Host header, and protects each session with random
capability tokens. Native MP4/WebM retains HTTP byte-range seeking; live HLS
conversion uses a bounded rolling buffer. Google Cast is unavailable for local
streams; AirPlay is exposed only when the browser reports it as supported.
