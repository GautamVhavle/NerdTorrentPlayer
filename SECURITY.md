# Security Policy

## Supported Versions

Security fixes are applied to the latest version on the `main` branch.

## Reporting A Vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's private security advisory flow for this repository:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Include reproduction steps, affected files or endpoints, impact, and any
   mitigation you identified.

If private reporting is unavailable, contact the repository owner through their
GitHub profile and request a private disclosure channel. Please allow a
reasonable amount of time for a response before publishing details.

## Security Boundaries

NerdTorrentPlayer has two distinct execution environments:

- The hosted frontend runs in a browser and uses WebRTC/WSS-compatible
  WebTorrent routes only.
- The optional native bridge runs on the user's machine and may access
  conventional BitTorrent peers and FFmpeg.

High-priority reports include:

- Bridge access from a non-loopback host or an untrusted page origin.
- Bypass of bridge bootstrap or per-session capability tokens.
- Session-token leakage, including in logs, errors, redirects, or playlist URLs
  outside the local app.
- Arbitrary file read/write, path traversal, command injection, or unsafe FFmpeg
  argument construction.
- Cross-site request forgery or DNS rebinding that can control the bridge.
- Unsafe processing of magnets, `.torrent` bytes, subtitles, or media metadata.
- Persistent XSS, local data exposure, or unauthorized access to IndexedDB data.

## Non-Goals

The following are expected properties of BitTorrent/WebRTC and are not treated
as application vulnerabilities by themselves:

- Torrent peers observing the public IP address used for swarm traffic.
- Browser-only mode being unable to reach conventional TCP/uTP peers or UDP
  trackers.
- A torrent failing when no WebRTC-compatible peer, WSS route, or web seed exists.

## Handling Expectations

Reports are triaged for reproducibility and impact. When a fix is accepted, the
maintainer will coordinate disclosure timing, publish a patch, and credit the
reporter when they consent.