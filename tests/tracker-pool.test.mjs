import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_WEBTORRENT_TRACKERS,
  getParsedTorrentFallbacks,
  inspectTorrentPrivacy,
  prepareBrowserTorrentId,
  uniqueSecureTrackers,
} from "../src/torrent/tracker-pool.ts";

test("uses the current official secure WebTorrent tracker pool", () => {
  assert.deepEqual([...OFFICIAL_WEBTORRENT_TRACKERS], [
    "wss://tracker.btorrent.xyz",
    "wss://tracker.openwebtorrent.com",
    "wss://tracker.webtorrent.dev",
  ]);
});

test("keeps only a bounded set of usable browser trackers", () => {
  const params = new URLSearchParams({
    xt: "urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10",
    dn: "Sintel",
    xs: "https://webtorrent.io/torrents/sintel.torrent",
    ws: "https://webtorrent.io/torrents/",
  });
  params.append("tr", "udp://tracker.example:80");
  params.append("tr", "https://tracker.example/announce");
  for (let index = 0; index < 10; index += 1) {
    params.append("tr", `wss://tracker-${index}.example/announce`);
  }

  const prepared = prepareBrowserTorrentId(`magnet:?${params}`);
  assert.equal(typeof prepared.value, "string");
  assert.equal(prepared.publicFallbacksAdded, true);
  assert.match(
    prepared.value,
    /xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10/,
  );
  assert.equal(prepared.trackers.length, 8);
  assert.deepEqual(prepared.trackers.slice(-3), [
    ...OFFICIAL_WEBTORRENT_TRACKERS,
  ]);

  const sanitized = new URL(prepared.value);
  assert.equal(sanitized.searchParams.get("dn"), "Sintel");
  assert.equal(
    sanitized.searchParams.get("xs"),
    "https://webtorrent.io/torrents/sintel.torrent",
  );
  assert.equal(
    sanitized.searchParams.get("ws"),
    "https://webtorrent.io/torrents/",
  );
  assert.ok(
    sanitized.searchParams
      .getAll("tr")
      .every((tracker) => tracker.startsWith("wss://")),
  );
});

test("normalizes and deduplicates secure trackers without mutating torrent bytes", () => {
  assert.deepEqual(
    uniqueSecureTrackers([
      "wss://TRACKER.EXAMPLE/",
      "wss://tracker.example",
      "ws://tracker.example",
      "not a url",
    ]),
    ["wss://tracker.example"],
  );

  const bytes = new Uint8Array([100, 4, 105, 110, 102, 111]);
  const prepared = prepareBrowserTorrentId(bytes);
  assert.strictEqual(prepared.value, bytes);
  assert.deepEqual(prepared.trackers, []);
  assert.equal(prepared.publicFallbacksAdded, false);
});

test("never injects public fallbacks into a parsed private torrent", () => {
  assert.deepEqual(getParsedTorrentFallbacks(true), []);
  assert.deepEqual(getParsedTorrentFallbacks(false), [
    ...OFFICIAL_WEBTORRENT_TRACKERS,
  ]);
});

test("inspects the private bit before opening public tracker connections", async () => {
  const privateBytes = new TextEncoder().encode(
    "d4:infod4:name4:test7:privatei1eee",
  );
  const publicBytes = new TextEncoder().encode("d4:infod4:name4:testee");

  assert.equal(await inspectTorrentPrivacy(privateBytes), true);
  assert.equal(await inspectTorrentPrivacy(publicBytes), false);
  assert.equal(await inspectTorrentPrivacy(new Uint8Array([0, 1, 2])), null);
});
