# Local native torrent bridge

The bridge gives the localhost web app access to conventional BitTorrent peers
(TCP, UDP trackers, HTTP trackers, DHT, and peer exchange) without turning the
host into a public relay. It listens only on `127.0.0.1` and accepts API calls
only from the local development app.

Start it alongside the web app:

```sh
npm run bridge
```

Defaults:

- URL: `http://127.0.0.1:41780`
- allowed origins: `http://localhost:3000,http://127.0.0.1:3000`
- idle session lifetime: 30 minutes
- maximum sessions/streams/transcodes: 3/4/1

`BRIDGE_PORT`, `BRIDGE_ALLOWED_ORIGINS`, and `BRIDGE_FFMPEG_PATH` may be set to
override the port, comma-separated trusted app origins, and ffmpeg executable.
Only loopback HTTP origins are accepted. The bind address is intentionally not
configurable.

## API

1. `GET /v1/capabilities` returns transport/playback capabilities and an
   ephemeral `bridge.bootstrapToken`. The response is available only to an
   allowed Origin.
2. `POST /v1/sessions` with `X-Bridge-Token: <bootstrapToken>`,
   `Content-Type: application/json`, and `{ "magnet": "magnet:?xt=..." }`
   returns `202` with a session ID, session token, and pollable `statusUrl`.
3. `GET /v1/sessions/:id` with `Authorization: Bearer <sessionToken>` returns
   `resolving`, `ready`, or `error`, metadata, live transfer stats, and file
   stream capabilities.
4. `GET|HEAD /v1/sessions/:id/files/:index/stream?token=...` serves the original
   file with single-range HTTP support.
5. `GET|HEAD /v1/sessions/:id/files/:index/remux?token=...` copies compatible
   H.264/AAC streams into fragmented MP4 through ffmpeg. This is the lightweight
   path for a compatible MKV. `/transcode?token=...` instead converts video to
   H.264 and audio to AAC when the source codecs are not browser-compatible.
   Both start without first downloading the whole file, but do not support
   byte-range seeking; seeking must restart the ffmpeg stream.
6. `GET|HEAD /v1/sessions/:id/files/:index/hls/index.m3u8?token=...`
   starts or reuses a real-time ffmpeg process that copies compatible H.264/AAC
   into a bounded sliding window of MPEG-TS segments. Playlist segment URLs are
   rewritten with the private session token. HLS files live in a private OS
   temporary directory and are removed with the session.
7. `DELETE /v1/sessions/:id` with the session bearer token stops streams,
   removes temporary piece storage, and destroys the torrent session.

The bootstrap and session tokens are random and rotate every bridge process.
Stream URLs use the session token because a media element cannot attach an
Authorization header. Do not copy these URLs outside the local app.
