import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  buildFfmpegArgs,
  buildHlsFfmpegArgs,
  createBridge,
  parseSingleRange,
  validateMagnet,
} from "../backend/bridge/server.mjs";

const ORIGIN = "http://localhost:3000";
const MAGNET = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=fixture";

class FakeFile {
  constructor(name, data, type = "video/mp4") {
    this.name = name;
    this.path = name;
    this.data = Buffer.from(data);
    this.length = this.data.length;
    this.type = type;
    this.downloaded = this.length;
    this.progress = 1;
  }

  createReadStream({ start = 0, end = this.length - 1 } = {}) {
    return Readable.from(this.data.subarray(start, end + 1));
  }
}

class FakeTorrent extends EventEmitter {
  constructor(file = new FakeFile("fixture.mp4", "0123456789")) {
    super();
    this.infoHash = "0123456789abcdef0123456789abcdef01234567";
    this.name = "fixture";
    this.files = [file];
    this.length = file.length;
    this.numPeers = 2;
    this.downloaded = file.length;
    this.received = file.length;
    this.uploaded = 0;
    this.progress = 1;
    this.downloadSpeed = 100;
    this.uploadSpeed = 0;
    this.timeRemaining = 0;
    this.ratio = 0;
    this.done = true;
    this.destroyed = false;
  }
}

class FakeClient extends EventEmitter {
  constructor(file) {
    super();
    this.dht = {};
    this.destroyed = false;
    this.addCalls = 0;
    this.removeCalls = 0;
    this.file = file;
  }

  add(_magnet, _options, ready) {
    this.addCalls += 1;
    const torrent = new FakeTorrent(this.file);
    queueMicrotask(() => ready(torrent));
    return torrent;
  }

  async remove(torrent, _options, callback) {
    this.removeCalls += 1;
    torrent.destroyed = true;
    callback?.();
  }

  destroy(callback) {
    this.destroyed = true;
    callback?.();
  }
}

function headers(extra = {}) {
  return { Origin: ORIGIN, ...extra };
}

async function fixture(options = {}) {
  const { file, ...bridgeOptions } = options;
  const client = new FakeClient(file);
  const bridge = createBridge({
    client,
    allowedOrigins: [ORIGIN],
    ffmpeg: { available: false, path: "ffmpeg", version: null },
    metadataTimeoutMs: 10_000,
    ...bridgeOptions,
  });
  const address = await bridge.listen(0);
  return { bridge, client, url: address.url };
}

async function createSession(url) {
  const capabilityResponse = await fetch(`${url}/v1/capabilities`, { headers: headers() });
  assert.equal(capabilityResponse.status, 200);
  const capabilities = await capabilityResponse.json();
  assert.equal(capabilities.playback.hls.playlistMode, "growing-archive");
  assert.equal(capabilities.playback.hls.segmentDurationSeconds, 2);
  const response = await fetch(`${url}/v1/sessions`, {
    method: "POST",
    headers: headers({
      "Content-Type": "application/json",
      "X-Bridge-Token": capabilities.bridge.bootstrapToken,
    }),
    body: JSON.stringify({ magnet: MAGNET }),
  });
  assert.equal(response.status, 202);
  const body = await response.json();
  await new Promise((resolve) => setImmediate(resolve));
  return body.session;
}

test("range parser accepts one bounded byte range", () => {
  assert.deepEqual(parseSingleRange(undefined, 10), null);
  assert.deepEqual(parseSingleRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseSingleRange("bytes=7-", 10), { start: 7, end: 9 });
  assert.deepEqual(parseSingleRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseSingleRange("bytes=0-1,4-5", 10), { invalid: true });
  assert.deepEqual(parseSingleRange("bytes=10-11", 10), { invalid: true });
});

test("magnet validation accepts BTIH and rejects remote torrent URLs", () => {
  assert.equal(validateMagnet(MAGNET), MAGNET);
  assert.throws(() => validateMagnet("https://example.com/file.torrent"), /only BitTorrent/);
  assert.throws(() => validateMagnet("magnet:?dn=missing-hash"), /only BitTorrent/);
});

test("ffmpeg arguments support lightweight remux and codec fallback", () => {
  const remux = buildFfmpegArgs("remux");
  const transcode = buildFfmpegArgs("transcode");
  assert.deepEqual(remux.slice(remux.indexOf("-c:v"), remux.indexOf("-c:v") + 4), [
    "-c:v", "copy", "-c:a", "copy",
  ]);
  assert.ok(transcode.includes("libx264"));
  assert.ok(transcode.includes("aac"));
  assert.ok(remux.includes("frag_keyframe+empty_moov+default_base_moof"));
  assert.deepEqual(remux.slice(-3), ["-f", "mp4", "pipe:1"]);

  const hls = buildHlsFfmpegArgs("/private/hls");
  assert.ok(!hls.includes("-re"));
  assert.ok(hls.includes("libx264"));
  assert.ok(hls.includes("yuv420p"));
  assert.deepEqual(hls.slice(hls.indexOf("-crf"), hls.indexOf("-crf") + 6), [
    "-crf", "23", "-maxrate", "4M", "-bufsize", "8M",
  ]);
  assert.ok(hls.includes("aac"));
  assert.ok(hls.includes("expr:gte(t,n_forced*2)"));
  assert.ok(hls.includes("independent_segments+temp_file"));
  assert.deepEqual(hls.slice(hls.indexOf("-hls_time"), hls.indexOf("-hls_time") + 4), [
    "-hls_time", "2", "-hls_list_size", "0",
  ]);
  assert.ok(hls.includes("/private/hls/segment-%06d.ts"));
  assert.equal(hls.at(-1), "/private/hls/index.m3u8");
});

test("bridge rejects untrusted origins before adding a torrent", async (t) => {
  const { bridge, client, url } = await fixture();
  t.after(() => bridge.close());

  const response = await fetch(`${url}/v1/capabilities`, {
    headers: { Origin: "https://attacker.example" },
  });
  assert.equal(response.status, 403);
  assert.equal(client.addCalls, 0);
});

test("bridge rejects a non-loopback Host to prevent DNS rebinding", async (t) => {
  const { bridge, url } = await fixture();
  t.after(() => bridge.close());

  const status = await new Promise((resolve, reject) => {
    const req = request(`${url}/v1/capabilities`, {
      headers: headers({ Host: "attacker.example" }),
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    req.once("error", reject);
    req.end();
  });
  assert.equal(status, 421);
});

test("session API is token protected and raw stream supports ranges", async (t) => {
  const { bridge, client, url } = await fixture();
  t.after(() => bridge.close());
  const created = await createSession(url);

  const unauthorized = await fetch(`${url}/v1/sessions/${created.id}`, { headers: headers() });
  assert.equal(unauthorized.status, 401);

  const statusResponse = await fetch(`${url}/v1/sessions/${created.id}`, {
    headers: headers({ Authorization: `Bearer ${created.token}` }),
  });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.session.state, "ready");
  assert.equal(status.session.torrent.numPeers, 2);
  assert.equal(status.session.files[0].streams.raw.supportsRange, true);
  assert.equal(status.session.files[0].streams.hls.available, false);
  assert.equal(status.session.files[0].streams.remux.available, false);
  assert.equal(status.session.files[0].streams.transcode.available, false);

  const streamResponse = await fetch(status.session.files[0].streams.raw.url, {
    headers: headers({ Range: "bytes=2-5" }),
  });
  assert.equal(streamResponse.status, 206);
  assert.equal(streamResponse.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await streamResponse.text(), "2345");

  const invalidRange = await fetch(status.session.files[0].streams.raw.url, {
    headers: headers({ Range: "bytes=0-1,3-4" }),
  });
  assert.equal(invalidRange.status, 416);

  const deleted = await fetch(`${url}/v1/sessions/${created.id}`, {
    method: "DELETE",
    headers: headers({ Authorization: `Bearer ${created.token}` }),
  });
  assert.equal(deleted.status, 204);
  assert.equal(client.removeCalls, 1);
});

test("creating a new session replaces the prior local session", async (t) => {
  const { bridge, client, url } = await fixture({ maxSessions: 1 });
  t.after(() => bridge.close());

  const first = await createSession(url);
  const second = await createSession(url);

  assert.notEqual(second.id, first.id);
  assert.equal(client.addCalls, 2);
  assert.equal(client.removeCalls, 1);
  assert.equal(bridge.sessions.size, 1);
});

test("missing ffmpeg is reported without starting a raw download", async (t) => {
  const { bridge, url } = await fixture();
  t.after(() => bridge.close());
  const created = await createSession(url);
  const transcodeUrl = `${url}/v1/sessions/${created.id}/files/0/transcode?token=${created.token}`;
  const response = await fetch(transcodeUrl, { headers: headers() });
  assert.equal(response.status, 501);
  const body = await response.json();
  assert.equal(body.error.code, "ffmpeg_unavailable");
});

const ffmpegCheck = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
const ffmpegAvailable = ffmpegCheck.status === 0;

test("remux and HLS endpoints produce playable browser media", { skip: !ffmpegAvailable }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "torrent-bridge-test-"));
  const mkvPath = join(directory, "fixture.mkv");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const generated = spawnSync("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-loglevel", "error",
    "-f", "lavfi",
    "-i", "testsrc2=size=160x90:rate=24",
    "-f", "lavfi",
    "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "0.5",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    mkvPath,
  ], { stdio: "pipe" });
  assert.equal(generated.status, 0, generated.stderr?.toString());

  const file = new FakeFile("fixture.mkv", await readFile(mkvPath), "video/x-matroska");
  const { bridge, url } = await fixture({
    file,
    ffmpeg: { available: true, path: "ffmpeg", version: "test" },
  });
  t.after(() => bridge.close());
  const created = await createSession(url);
  const response = await fetch(
    `${url}/v1/sessions/${created.id}/files/0/remux?token=${created.token}`,
    { headers: headers(), signal: AbortSignal.timeout(10_000) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("x-bridge-playback"), "remux-copy-fmp4");
  const output = Buffer.from(await response.arrayBuffer());
  assert.ok(output.length > 1_000);

  const probed = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_name",
    "-of", "csv=p=0",
    "pipe:0",
  ], { input: output, encoding: "utf8" });
  assert.equal(probed.status, 0, probed.stderr);
  assert.match(probed.stdout, /h264/);
  assert.match(probed.stdout, /aac/);

  const playlistResponse = await fetch(
    `${url}/v1/sessions/${created.id}/files/0/hls/index.m3u8?token=${created.token}`,
    { headers: headers(), signal: AbortSignal.timeout(10_000) },
  );
  assert.equal(playlistResponse.status, 200);
  assert.equal(playlistResponse.headers.get("content-type"), "application/vnd.apple.mpegurl");
  const playlist = await playlistResponse.text();
  assert.match(playlist, /#EXTM3U/);
  const segmentUrl = playlist.split(/\r?\n/).find((line) => line && !line.startsWith("#"));
  assert.ok(segmentUrl);
  assert.equal(new URL(segmentUrl).searchParams.get("token"), created.token);
  assert.match(new URL(segmentUrl).pathname, /\/hls\/segment-\d{6}\.ts$/);

  const segmentResponse = await fetch(segmentUrl, { headers: headers() });
  assert.equal(segmentResponse.status, 200);
  assert.equal(segmentResponse.headers.get("content-type"), "video/mp2t");
  const segment = Buffer.from(await segmentResponse.arrayBuffer());
  assert.ok(segment.length > 1_000);
  const segmentProbe = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_name",
    "-of", "csv=p=0",
    "pipe:0",
  ], { input: segment, encoding: "utf8" });
  assert.equal(segmentProbe.status, 0, segmentProbe.stderr);
  assert.match(segmentProbe.stdout, /h264/);
  assert.match(segmentProbe.stdout, /aac/);

  const sessionRecord = bridge.sessions.get(created.id);
  const hlsDirectory = await sessionRecord.hlsDirectory;
  const secondPlaylist = await fetch(
    `${url}/v1/sessions/${created.id}/files/0/hls/index.m3u8?token=${created.token}`,
    { headers: headers() },
  );
  assert.equal(secondPlaylist.status, 200);
  assert.equal(sessionRecord.hlsJobs.size, 1, "playlist polling must reuse the existing ffmpeg job");

  const unsignedSegment = new URL(segmentUrl);
  unsignedSegment.search = "";
  const unauthorizedSegment = await fetch(unsignedSegment, { headers: headers() });
  assert.equal(unauthorizedSegment.status, 401);

  const deleted = await fetch(`${url}/v1/sessions/${created.id}`, {
    method: "DELETE",
    headers: headers({ Authorization: `Bearer ${created.token}` }),
  });
  assert.equal(deleted.status, 204);
  await assert.rejects(stat(hlsDirectory), (error) => error?.code === "ENOENT");

  const limited = await fixture({
    file,
    ffmpeg: { available: true, path: "ffmpeg", version: "test" },
    hlsMaxBytes: 1,
  });
  t.after(() => limited.bridge.close());
  const limitedSession = await createSession(limited.url);
  const overLimit = await fetch(
    `${limited.url}/v1/sessions/${limitedSession.id}/files/0/hls/index.m3u8?token=${limitedSession.token}`,
    { headers: headers(), signal: AbortSignal.timeout(10_000) },
  );
  assert.equal(overLimit.status, 422);
  const limitedDirectory = await limited.bridge.sessions.get(limitedSession.id).hlsDirectory;
  await assert.rejects(stat(limitedDirectory), (error) => error?.code === "ENOENT");
});
