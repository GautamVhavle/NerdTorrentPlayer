import assert from "node:assert/strict";
import WebTorrent from "webtorrent";

const SAMPLE_TORRENT_URL = "https://webtorrent.io/torrents/sintel.torrent";
const EXPECTED_INFO_HASH = "08ada5a7a6183aae1e09d831df6748d566095a10";
const SAMPLE_BYTES = 256 * 1024;

const client = new WebTorrent({
  dht: false,
  lsd: false,
  natUpnp: false,
  natPmp: false,
  utp: false,
});

function destroyClient() {
  return new Promise((resolve) => {
    try {
      client.destroy(() => resolve());
    } catch {
      resolve();
    }
  });
}

function addTorrent(bytes) {
  return new Promise((resolve, reject) => {
    const torrent = client.add(
      bytes,
      {
        deselect: true,
        strategy: "sequential",
        destroyStoreOnDestroy: true,
      },
      resolve,
    );
    torrent.once("error", reject);
    torrent.on("warning", () => {
      // Individual public trackers can be unavailable; a web seed or another
      // tracker is enough for this end-to-end sample transfer.
    });
  });
}

function readPrefix(file) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const stream = file.createReadStream({ start: 0, end: SAMPLE_BYTES - 1 });
    stream.on("data", (chunk) => {
      received += chunk.length;
    });
    stream.once("end", () => resolve(received));
    stream.once("error", reject);
  });
}

const timeout = setTimeout(() => {
  console.error("Live torrent smoke test timed out.");
  void destroyClient().finally(() => process.exit(1));
}, 45_000);

try {
  const response = await fetch(SAMPLE_TORRENT_URL, {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.ok, true, "Official Sintel .torrent should be reachable");

  const torrent = await addTorrent(new Uint8Array(await response.arrayBuffer()));
  assert.equal(torrent.infoHash, EXPECTED_INFO_HASH);

  const media = torrent.files.find((file) => file.name === "Sintel.mp4");
  assert.ok(media, "Sintel.mp4 should be present in the sample torrent");
  media.select();

  const received = await readPrefix(media);
  assert.equal(received, SAMPLE_BYTES);
  console.log(
    JSON.stringify({
      status: "passed",
      sample: media.name,
      infoHash: torrent.infoHash,
      bytesRead: received,
      peersOrWebSeeds: torrent.numPeers,
      downloadSpeed: Math.round(torrent.downloadSpeed),
    }),
  );
} finally {
  clearTimeout(timeout);
  await destroyClient();
}
