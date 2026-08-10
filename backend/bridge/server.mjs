import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream as createFsReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import WebTorrent from "webtorrent";

const BRIDGE_VERSION = "1";
const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 41780;
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_METADATA_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_JSON_BYTES = 16 * 1024;
const MAX_MAGNET_BYTES = 12 * 1024;
const MAX_WARNINGS = 10;
const HLS_PLAYLIST_NAME = "index.m3u8";
const HLS_SEGMENT_PATTERN = /^segment-\d{6}\.ts$/;
// Conventional swarms can take a while to deliver the first contiguous media
// range. Keep the conversion alive long enough for a cold/slow peer set to
// assemble its first short HLS segment.
const HLS_READY_TIMEOUT_MS = 120_000;
const DEFAULT_HLS_MAX_BYTES = 128 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function token(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

function tokenDigest(value) {
  return createHash("sha256").update(value).digest();
}

function tokensMatch(candidate, digest) {
  if (typeof candidate !== "string" || candidate.length > 256) return false;
  const candidateDigest = tokenDigest(candidate);
  return timingSafeEqual(candidateDigest, digest);
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function safeFilename(value) {
  return encodeURIComponent(value).replaceAll("'", "%27");
}

function normalizeAllowedOrigins(origins) {
  const values = Array.isArray(origins) ? origins : String(origins).split(",");
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error("At least one localhost app origin must be configured");
  }

  for (const origin of normalized) {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      throw new Error(`Bridge origin must be a local HTTP origin: ${origin}`);
    }
    if (parsed.origin !== origin) {
      throw new Error(`Bridge origin must not include a path: ${origin}`);
    }
  }

  return new Set(normalized);
}

export function validateMagnet(value) {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_magnet", "magnet must be a string");
  }

  const magnet = value.trim();
  if (Buffer.byteLength(magnet) > MAX_MAGNET_BYTES) {
    throw new HttpError(413, "magnet_too_large", "magnet exceeds the bridge limit");
  }

  let parsed;
  try {
    parsed = new URL(magnet);
  } catch {
    throw new HttpError(400, "invalid_magnet", "magnet is not a valid URI");
  }

  const hasBtih = parsed.searchParams
    .getAll("xt")
    .some((value) => /^urn:btih:(?:[a-f\d]{40}|[a-z2-7]{32})$/i.test(value));

  if (parsed.protocol !== "magnet:" || !hasBtih) {
    throw new HttpError(400, "invalid_magnet", "only BitTorrent magnet URIs are accepted");
  }

  return magnet;
}

export function parseSingleRange(header, length) {
  if (!header) return null;
  if (!Number.isSafeInteger(length) || length < 0) return { invalid: true };

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return { invalid: true };

  let start;
  let end;
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(length - suffixLength, 0);
    end = length - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? length - 1 : Number(match[2]);
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= length ||
    end < start
  ) {
    return { invalid: true };
  }

  return { start, end: Math.min(end, length - 1) };
}

export function buildFfmpegArgs(mode = "transcode") {
  const common = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-fflags",
    "+genpts",
    "-i",
    "pipe:0",
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
  ];
  const codecs = mode === "remux"
    ? ["-c:v", "copy", "-c:a", "copy"]
    : [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-ac",
        "2",
      ];
  return [
    ...common,
    ...codecs,
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "-f",
    "mp4",
    "pipe:1",
  ];
}

export function buildHlsFfmpegArgs(directory) {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-fflags",
    "+genpts",
    "-re",
    "-i",
    "pipe:0",
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
    "-c:v",
    "copy",
    "-c:a",
    "copy",
    "-f",
    "hls",
    "-hls_segment_type",
    "mpegts",
    "-hls_time",
    "1",
    "-hls_list_size",
    "24",
    "-hls_delete_threshold",
    "4",
    "-hls_allow_cache",
    "0",
    "-hls_flags",
    "delete_segments+split_by_time+temp_file",
    "-hls_segment_filename",
    join(directory, "segment-%06d.ts"),
    join(directory, HLS_PLAYLIST_NAME),
  ];
}

function detectFfmpeg(path = process.env.BRIDGE_FFMPEG_PATH || "ffmpeg") {
  const result = spawnSync(path, ["-version"], {
    encoding: "utf8",
    timeout: 2_000,
    windowsHide: true,
  });
  const firstLine = result.stdout?.split(/\r?\n/, 1)[0] || null;
  return {
    available: !result.error && result.status === 0,
    path,
    version: firstLine,
  };
}

function defaultClient() {
  return new WebTorrent({
    dht: true,
    lsd: true,
    utPex: true,
    natUpnp: false,
    natPmp: false,
    secure: 1,
  });
}

function destroyClient(client) {
  return new Promise((resolve) => {
    if (!client || client.destroyed) return resolve();
    try {
      client.destroy(() => resolve());
    } catch {
      resolve();
    }
  });
}

function removeTorrent(client, torrent) {
  return new Promise((resolve) => {
    if (!torrent || torrent.destroyed) return resolve();
    try {
      const result = client.remove(torrent, { destroyStore: true }, () => resolve());
      if (result && typeof result.catch === "function") {
        result.catch(() => resolve());
      }
    } catch {
      resolve();
    }
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      reject(new HttpError(415, "unsupported_media_type", "Content-Type must be application/json"));
      return;
    }

    const contentLength = Number(req.headers["content-length"] || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
      reject(new HttpError(413, "body_too_large", "request body exceeds the bridge limit"));
      return;
    }

    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        reject(new HttpError(413, "body_too_large", "request body exceeds the bridge limit"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.once("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "invalid_json", "request body must be valid JSON"));
      }
    });
    req.once("error", reject);
  });
}

function json(res, status, value, headers = {}) {
  const body = status === 204 ? "" : JSON.stringify(value);
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...headers,
  });
  res.end(body);
}

function bearerToken(req) {
  const value = req.headers.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
  return value.slice("Bearer ".length);
}

function sessionState(session) {
  if (session.error) return "error";
  if (session.ready) return "ready";
  return "resolving";
}

function detachSessionListeners(session) {
  if (!session.torrent || !session.listeners) return;
  for (const [event, listener] of session.listeners) {
    session.torrent.removeListener(event, listener);
  }
  session.listeners = null;
}

function toNodeReadable(stream) {
  if (stream instanceof Readable || typeof stream.pipe === "function") return stream;
  return Readable.from(stream);
}

export function createBridge(options = {}) {
  const client = options.client || defaultClient();
  const allowedOrigins = normalizeAllowedOrigins(
    options.allowedOrigins || process.env.BRIDGE_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS,
  );
  const ffmpeg = options.ffmpeg || detectFfmpeg();
  const bootstrapToken = token(32);
  const bootstrapDigest = tokenDigest(bootstrapToken);
  const sessions = new Map();
  const sessionTtlMs = options.sessionTtlMs || DEFAULT_SESSION_TTL_MS;
  const metadataTimeoutMs = options.metadataTimeoutMs || DEFAULT_METADATA_TIMEOUT_MS;
  const maxSessions = options.maxSessions || 3;
  const maxStreams = options.maxStreams || 4;
  const maxTranscodes = options.maxTranscodes || 1;
  const hlsMaxBytes = options.hlsMaxBytes || DEFAULT_HLS_MAX_BYTES;
  let activeStreams = 0;
  let activeTranscodes = 0;
  let closed = false;

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      if (res.headersSent || res.destroyed) {
        res.destroy();
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : "internal_error";
      const message = error instanceof HttpError ? error.message : "The bridge could not complete the request";
      json(res, status, { error: { code, message } }, corsHeaders(req));
    });
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  function address() {
    const current = server.address();
    if (!current || typeof current === "string") return null;
    return { host: LOOPBACK_HOST, port: current.port, url: `http://${LOOPBACK_HOST}:${current.port}` };
  }

  function requestHostAllowed(req) {
    const current = address();
    if (!current) return false;
    return req.headers.host === `${LOOPBACK_HOST}:${current.port}` || req.headers.host === `localhost:${current.port}`;
  }

  function originAllowed(req) {
    return typeof req.headers.origin === "string" && allowedOrigins.has(req.headers.origin);
  }

  function corsHeaders(req) {
    if (!originAllowed(req)) return {};
    return {
      "Access-Control-Allow-Origin": req.headers.origin,
      // Chrome preflights cross-origin requests into the loopback address
      // space. This is safe here because the bridge is bound to 127.0.0.1 and
      // `originAllowed` has already restricted the caller to the local app.
      "Access-Control-Allow-Private-Network": "true",
      "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
      Vary: "Origin",
    };
  }

  function requireApiOrigin(req) {
    if (!requestHostAllowed(req)) {
      throw new HttpError(421, "invalid_host", "request Host is not the loopback bridge");
    }
    if (!originAllowed(req)) {
      throw new HttpError(403, "origin_denied", "request Origin is not an allowed localhost app");
    }
  }

  function requireBootstrap(req) {
    if (!tokensMatch(req.headers["x-bridge-token"], bootstrapDigest)) {
      throw new HttpError(401, "invalid_bridge_token", "bridge token is missing or invalid");
    }
  }

  function getSession(id) {
    const session = sessions.get(id);
    if (!session) throw new HttpError(404, "session_not_found", "torrent session was not found");
    return session;
  }

  function requireSession(req, session, queryToken = null) {
    const candidate = queryToken || bearerToken(req);
    if (!tokensMatch(candidate, session.tokenDigest)) {
      throw new HttpError(401, "invalid_session_token", "session token is missing or invalid");
    }
  }

  function touch(session) {
    session.lastAccessAt = Date.now();
  }

  function attachTorrent(session, torrent) {
    session.torrent = torrent;
    const onInfoHash = () => {
      session.infoHash = torrent.infoHash || session.infoHash;
    };
    const onWarning = (warning) => {
      session.warnings.push({ at: new Date().toISOString(), message: errorMessage(warning) });
      session.warnings = session.warnings.slice(-MAX_WARNINGS);
    };
    const onError = (error) => {
      session.error = { code: "torrent_error", message: errorMessage(error) };
      clearTimeout(session.metadataTimer);
    };
    const onDone = () => {
      session.completedAt = Date.now();
    };
    session.listeners = [
      ["infoHash", onInfoHash],
      ["warning", onWarning],
      ["error", onError],
      ["done", onDone],
    ];
    for (const [event, listener] of session.listeners) torrent.on(event, listener);
  }

  function markReady(session, torrent) {
    if (!sessions.has(session.id) || session.error) return;
    clearTimeout(session.metadataTimer);
    session.ready = true;
    session.infoHash = torrent.infoHash || session.infoHash;
    session.metadataReceivedAt = Date.now();
  }

  async function releaseTorrent(session) {
    clearTimeout(session.metadataTimer);
    detachSessionListeners(session);
    const torrent = session.torrent;
    session.torrent = null;
    await removeTorrent(client, torrent);
  }

  function addSessionWarning(session, message) {
    session.warnings.push({ at: new Date().toISOString(), message });
    session.warnings = session.warnings.slice(-MAX_WARNINGS);
  }

  async function ensureHlsDirectory(session) {
    if (!session.hlsDirectory) {
      session.hlsDirectory = mkdtemp(join(tmpdir(), "webtorrent-player-hls-"));
    }
    return session.hlsDirectory;
  }

  async function directorySize(directory) {
    let total = 0;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      try {
        if (entry.isDirectory()) total += await directorySize(entryPath);
        else if (entry.isFile()) total += (await stat(entryPath)).size;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    return total;
  }

  async function waitForHlsFile(path, job, timeoutMs, requireSegment = false) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (job.error) throw job.error;
      try {
        const data = await readFile(path);
        if (!requireSegment || data.toString("utf8").split(/\r?\n/).some((line) => {
          const name = line.trim().split(/[\\/]/).at(-1);
          return HLS_SEGMENT_PATTERN.test(name || "");
        })) {
          return data;
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    throw new HttpError(504, "hls_start_timeout", "HLS did not produce a segment in time");
  }

  function stopHlsProcess(job, kill = true) {
    if (job.processReleased) return;
    job.processReleased = true;
    clearInterval(job.diskTimer);
    job.input?.destroy?.();
    job.child?.stdin?.destroy();
    job.child?.stderr?.destroy();
    if (kill && job.child && !job.child.killed) job.child.kill("SIGKILL");
    if (job.processCounted) {
      job.processCounted = false;
      activeTranscodes = Math.max(0, activeTranscodes - 1);
    }
  }

  async function destroyHlsJob(job) {
    job.stopping = true;
    if (!job.error) job.error = new Error("HLS session stopped");
    stopHlsProcess(job);
    try {
      await job.startPromise;
    } catch {
      // A job still resolving its first segment is expected to reject on teardown.
    }
    if (job.directory) {
      await rm(job.directory, { recursive: true, force: true });
    }
  }

  async function enforceHlsDiskLimit(session, job) {
    if (job.diskScanPromise) return job.diskScanPromise;
    if (job.stopping || !job.directory) return;
    const scan = (async () => {
      try {
        const root = await session.hlsDirectory;
        const bytes = await directorySize(root);
        job.diskBytes = bytes;
        if (bytes <= hlsMaxBytes || job.stopping) return;
        const diskError = new Error(`HLS session disk limit exceeded (${hlsMaxBytes} bytes)`);
        addSessionWarning(session, diskError.message);
        for (const hlsJob of session.hlsJobs.values()) {
          hlsJob.error = diskError;
          hlsJob.state = "error";
          stopHlsProcess(hlsJob);
        }
        await rm(root, { recursive: true, force: true });
      } catch (error) {
        if (error?.code !== "ENOENT") addSessionWarning(session, errorMessage(error));
      }
    })();
    job.diskScanPromise = scan;
    try {
      await scan;
    } finally {
      if (job.diskScanPromise === scan) job.diskScanPromise = null;
    }
  }

  async function startHlsJob(session, file, index) {
    const existing = session.hlsJobs.get(index);
    if (existing) {
      await existing.startPromise;
      return existing;
    }

    const job = {
      index,
      directory: null,
      playlistPath: null,
      input: null,
      child: null,
      error: null,
      stderr: "",
      diskBytes: 0,
      diskTimer: null,
      diskScanPromise: null,
      processReleased: false,
      processCounted: false,
      stopping: false,
      state: "starting",
      startPromise: null,
    };
    session.hlsJobs.set(index, job);

    job.startPromise = (async () => {
      if (activeTranscodes >= maxTranscodes) {
        throw new HttpError(429, "transcode_limit", "another bridge media conversion is already active");
      }

      const root = await ensureHlsDirectory(session);
      job.directory = join(root, `file-${index}`);
      await mkdir(job.directory, { mode: 0o700 });
      if (job.stopping) throw job.error || new Error("HLS session stopped");
      job.playlistPath = join(job.directory, HLS_PLAYLIST_NAME);
      job.input = toNodeReadable(file.createReadStream({ start: 0, end: file.length - 1 }));

      activeTranscodes += 1;
      job.processCounted = true;
      try {
        job.child = spawn(ffmpeg.path, buildHlsFfmpegArgs(job.directory), {
          stdio: ["pipe", "ignore", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        stopHlsProcess(job, false);
        throw error;
      }

      job.child.stdin.on("error", () => {
        // EPIPE is expected when ffmpeg rejects input or the HLS job is stopped.
      });
      job.child.stderr.setEncoding("utf8");
      job.child.stderr.on("data", (chunk) => {
        job.stderr = (job.stderr + chunk).slice(-2_000);
      });
      job.child.once("error", (error) => {
        job.error = new Error(`ffmpeg failed to start HLS: ${errorMessage(error)}`);
        stopHlsProcess(job, false);
      });
      job.child.once("close", (code, signal) => {
        if ((code !== 0 || signal) && !job.stopping) {
          const detail = job.stderr.replaceAll(/\s+/g, " ").trim();
          if (!job.error) {
            const outcome = signal ? `signal ${signal}` : `status ${code}`;
            job.error = new Error(`ffmpeg HLS exited with ${outcome}${detail ? `: ${detail}` : ""}`);
          }
          addSessionWarning(session, job.error.message);
          job.state = "error";
        } else if (!job.stopping && !job.error) {
          job.state = "ended";
        }
        stopHlsProcess(job, false);
        void enforceHlsDiskLimit(session, job);
      });
      job.input.once("error", (error) => job.child.stdin.destroy(error));
      job.input.pipe(job.child.stdin);

      job.diskTimer = setInterval(() => {
        if (job.stopping || job.processReleased) return;
        void enforceHlsDiskLimit(session, job);
      }, 1_000);
      job.diskTimer.unref?.();
      if (job.processReleased) clearInterval(job.diskTimer);

      await waitForHlsFile(job.playlistPath, job, HLS_READY_TIMEOUT_MS, true);
      await enforceHlsDiskLimit(session, job);
      if (job.error) throw job.error;
      if (!job.stopping && job.state === "starting") job.state = "running";
    })().catch(async (error) => {
      if (!job.error) job.error = error instanceof Error ? error : new Error(String(error));
      job.state = "error";
      stopHlsProcess(job);
      if (job.diskScanPromise) await job.diskScanPromise;
      if (
        error instanceof HttpError &&
        ["transcode_limit", "hls_start_timeout"].includes(error.code)
      ) {
        session.hlsJobs.delete(index);
        if (job.directory) {
          await rm(job.directory, { recursive: true, force: true }).catch(() => {});
        }
      }
      throw error;
    });

    await job.startPromise;
    return job;
  }

  async function destroySession(session, remove = true) {
    if (session.destroying) return session.destroying;
    session.destroying = (async () => {
      for (const resource of session.resources) {
        try {
          resource();
        } catch {
          // Resource cleanup is best-effort; torrent teardown below is authoritative.
        }
      }
      session.resources.clear();
      await Promise.all([...session.hlsJobs.values()].map((job) => destroyHlsJob(job)));
      session.hlsJobs.clear();
      if (session.hlsDirectory) {
        try {
          await rm(await session.hlsDirectory, { recursive: true, force: true });
        } catch {
          // The bounded HLS monitor may already have removed this directory.
        }
      }
      await releaseTorrent(session);
      if (remove) sessions.delete(session.id);
    })();
    return session.destroying;
  }

  function startSession(magnet) {
    if (sessions.size >= maxSessions) {
      throw new HttpError(429, "session_limit", "close an existing session before adding another torrent");
    }

    const id = token(12);
    const sessionToken = token(32);
    const now = Date.now();
    const session = {
      id,
      token: sessionToken,
      tokenDigest: tokenDigest(sessionToken),
      createdAt: now,
      lastAccessAt: now,
      metadataReceivedAt: null,
      completedAt: null,
      ready: false,
      error: null,
      infoHash: null,
      torrent: null,
      listeners: null,
      warnings: [],
      resources: new Set(),
      hlsDirectory: null,
      hlsJobs: new Map(),
      destroying: null,
      metadataTimer: null,
    };
    sessions.set(id, session);

    try {
      const torrent = client.add(
        magnet,
        {
          deselect: true,
          strategy: "sequential",
          destroyStoreOnDestroy: true,
        },
        (readyTorrent) => markReady(session, readyTorrent),
      );
      attachTorrent(session, torrent);
    } catch (error) {
      sessions.delete(id);
      throw new HttpError(400, "torrent_rejected", errorMessage(error));
    }

    session.metadataTimer = setTimeout(() => {
      if (session.ready || session.error || !sessions.has(id)) return;
      session.error = {
        code: "metadata_timeout",
        message: `No torrent metadata arrived within ${Math.round(metadataTimeoutMs / 1000)} seconds`,
      };
      void releaseTorrent(session);
    }, metadataTimeoutMs);
    session.metadataTimer.unref?.();

    return session;
  }

  function fileStreams(req, session, index) {
    const base = `http://${req.headers.host}`;
    const tokenParam = encodeURIComponent(session.token);
    return {
      raw: {
        available: true,
        type: session.torrent.files[index].type || "application/octet-stream",
        supportsRange: true,
        url: `${base}/v1/sessions/${session.id}/files/${index}/stream?token=${tokenParam}`,
      },
      transcode: {
        available: ffmpeg.available,
        type: "video/mp4",
        supportsRange: false,
        url: ffmpeg.available
          ? `${base}/v1/sessions/${session.id}/files/${index}/transcode?token=${tokenParam}`
          : null,
        note: "Live H.264/AAC fragmented MP4; seeking restarts the stream",
      },
      hls: {
        available: ffmpeg.available,
        type: "application/vnd.apple.mpegurl",
        supportsRange: false,
        url: ffmpeg.available
          ? `${base}/v1/sessions/${session.id}/files/${index}/hls/${HLS_PLAYLIST_NAME}?token=${tokenParam}`
          : null,
        note: "Live sliding MPEG-TS HLS playlist with H.264/AAC copied from the source",
      },
      remux: {
        available: ffmpeg.available,
        type: "video/mp4",
        supportsRange: false,
        url: ffmpeg.available
          ? `${base}/v1/sessions/${session.id}/files/${index}/remux?token=${tokenParam}`
          : null,
        note: "Copies compatible H.264/AAC into fragmented MP4 without re-encoding",
      },
    };
  }

  function snapshot(req, session) {
    const torrent = session.torrent;
    const files = session.ready && torrent
      ? torrent.files.map((file, index) => ({
          id: String(index),
          index,
          name: file.name,
          path: file.path,
          length: file.length,
          type: file.type || "application/octet-stream",
          downloaded: file.downloaded || 0,
          progress: finiteNumber(file.progress) || 0,
          streams: fileStreams(req, session, index),
        }))
      : [];

    return {
      id: session.id,
      state: sessionState(session),
      createdAt: new Date(session.createdAt).toISOString(),
      lastAccessAt: new Date(session.lastAccessAt).toISOString(),
      expiresAt: new Date(session.lastAccessAt + sessionTtlMs).toISOString(),
      metadataReceivedAt: session.metadataReceivedAt
        ? new Date(session.metadataReceivedAt).toISOString()
        : null,
      error: session.error,
      warnings: session.warnings,
      torrent: torrent
        ? {
            infoHash: torrent.infoHash || session.infoHash,
            name: torrent.name || null,
            length: torrent.length || null,
            files: files.length,
            numPeers: torrent.numPeers || 0,
            downloaded: torrent.downloaded || 0,
            received: torrent.received || 0,
            uploaded: torrent.uploaded || 0,
            progress: finiteNumber(torrent.progress) || 0,
            downloadSpeed: finiteNumber(torrent.downloadSpeed) || 0,
            uploadSpeed: finiteNumber(torrent.uploadSpeed) || 0,
            timeRemaining: finiteNumber(torrent.timeRemaining),
            ratio: finiteNumber(torrent.ratio) || 0,
            done: Boolean(torrent.done),
          }
        : null,
      files,
    };
  }

  function sessionEnvelope(req, session, includeToken = false) {
    const state = snapshot(req, session);
    return {
      session: {
        ...(includeToken ? { token: session.token } : {}),
        ...state,
        statusUrl: `http://${req.headers.host}/v1/sessions/${session.id}`,
      },
    };
  }

  function findFile(session, indexValue) {
    if (!session.ready || !session.torrent) {
      throw new HttpError(409, "metadata_pending", "torrent metadata is not ready yet");
    }
    const index = Number(indexValue);
    if (!Number.isSafeInteger(index) || index < 0 || index >= session.torrent.files.length) {
      throw new HttpError(404, "file_not_found", "torrent file was not found");
    }
    return session.torrent.files[index];
  }

  function streamHeaders(req, extra = {}) {
    return {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer",
      ...corsHeaders(req),
      ...extra,
    };
  }

  function claimStream(session, cleanup) {
    if (activeStreams >= maxStreams) {
      throw new HttpError(429, "stream_limit", "too many bridge streams are active");
    }
    activeStreams += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeStreams -= 1;
      session.resources.delete(release);
      cleanup?.();
    };
    session.resources.add(release);
    return release;
  }

  function serveRaw(req, res, session, file) {
    const range = parseSingleRange(req.headers.range, file.length);
    if (range?.invalid) {
      res.writeHead(416, streamHeaders(req, {
        "Content-Range": `bytes */${file.length}`,
        "Content-Length": "0",
      }));
      res.end();
      return;
    }

    const selected = range || { start: 0, end: file.length - 1 };
    const length = selected.end - selected.start + 1;
    const status = range ? 206 : 200;
    const headers = streamHeaders(req, {
      "Accept-Ranges": "bytes",
      "Content-Type": file.type || "application/octet-stream",
      "Content-Length": String(length),
      "Content-Disposition": `inline; filename*=UTF-8''${safeFilename(file.name)}`,
      ...(range ? { "Content-Range": `bytes ${selected.start}-${selected.end}/${file.length}` } : {}),
    });
    if (req.method === "HEAD") {
      res.writeHead(status, headers);
      res.end();
      return;
    }

    let source;
    let release;
    try {
      release = claimStream(session, () => source?.destroy?.());
      source = toNodeReadable(file.createReadStream(selected));
    } catch (error) {
      release?.();
      throw error;
    }

    res.writeHead(status, headers);
    source.once("error", (error) => res.destroy(error));
    source.once("end", release);
    res.once("close", release);
    source.pipe(res);
  }

  function serveFfmpeg(req, res, session, file, mode) {
    if (!ffmpeg.available) {
      throw new HttpError(501, "ffmpeg_unavailable", "ffmpeg is not available to the local bridge");
    }
    if (req.method === "HEAD") {
      res.writeHead(200, streamHeaders(req, {
        "Accept-Ranges": "none",
        "Content-Type": "video/mp4",
      }));
      res.end();
      return;
    }
    if (activeTranscodes >= maxTranscodes) {
      throw new HttpError(429, "transcode_limit", "another bridge transcode is already active");
    }

    activeTranscodes += 1;
    let input;
    let child;
    let stderr = "";
    let release;
    try {
      input = toNodeReadable(file.createReadStream({ start: 0, end: file.length - 1 }));
      child = spawn(ffmpeg.path, buildFfmpegArgs(mode), {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      release = claimStream(session, () => {
        input.destroy?.();
        child.stdin.destroy();
        child.stdout.destroy();
        if (!child.killed) child.kill("SIGKILL");
        activeTranscodes -= 1;
      });
    } catch (error) {
      input?.destroy?.();
      child?.stdin?.destroy();
      child?.stdout?.destroy();
      if (child && !child.killed) child.kill("SIGKILL");
      activeTranscodes -= 1;
      throw error;
    }

    child.stdin.on("error", () => {
      // EPIPE is expected when ffmpeg rejects input or the response is cancelled.
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2_000);
    });
    child.once("error", (error) => {
      session.warnings.push({
        at: new Date().toISOString(),
        message: `ffmpeg failed to start: ${errorMessage(error)}`,
      });
      res.destroy(error);
      release();
    });
    child.once("close", (code) => {
      if (code && stderr) {
        session.warnings.push({
          at: new Date().toISOString(),
          message: `ffmpeg exited ${code}: ${stderr.replaceAll(/\s+/g, " ").trim()}`,
        });
        session.warnings = session.warnings.slice(-MAX_WARNINGS);
      }
      release();
    });
    input.once("error", (error) => child.stdin.destroy(error));
    child.stdout.once("error", (error) => res.destroy(error));
    res.once("close", release);

    res.writeHead(200, streamHeaders(req, {
      "Accept-Ranges": "none",
      "Content-Type": "video/mp4",
      "Content-Disposition": `inline; filename*=UTF-8''${safeFilename(file.name.replace(/\.[^.]+$/, ""))}.mp4`,
      "X-Bridge-Playback": mode === "remux" ? "remux-copy-fmp4" : "transcode-h264-aac-fmp4",
    }));
    input.pipe(child.stdin);
    child.stdout.pipe(res);
  }

  async function waitForHlsStat(path, job, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (job.error) throw job.error;
      try {
        const details = await stat(path);
        if (details.isFile()) return details;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new HttpError(404, "hls_segment_not_found", "HLS segment is no longer available");
  }

  function rewriteHlsPlaylist(req, session, index, playlist) {
    const base = `http://${req.headers.host}`;
    const tokenParam = encodeURIComponent(session.token);
    return playlist
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return line;
        const name = trimmed.split(/[\\/]/).at(-1);
        if (!name || !HLS_SEGMENT_PATTERN.test(name)) {
          throw new HttpError(500, "invalid_hls_playlist", "ffmpeg produced an unsafe HLS segment name");
        }
        return `${base}/v1/sessions/${session.id}/files/${index}/hls/${name}?token=${tokenParam}`;
      })
      .join("\n");
  }

  async function serveHls(req, res, session, file, index, asset) {
    if (!ffmpeg.available) {
      throw new HttpError(501, "ffmpeg_unavailable", "ffmpeg is not available to the local bridge");
    }

    let job;
    try {
      job = await startHlsJob(session, file, index);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(422, "hls_failed", errorMessage(error));
    }
    if (asset === HLS_PLAYLIST_NAME) {
      const source = await waitForHlsFile(job.playlistPath, job, 5_000, true);
      const body = rewriteHlsPlaylist(req, session, index, source.toString("utf8"));
      res.writeHead(200, streamHeaders(req, {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Content-Length": String(Buffer.byteLength(body)),
        "Access-Control-Expose-Headers": "Content-Length",
      }));
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }

    if (!HLS_SEGMENT_PATTERN.test(asset)) {
      throw new HttpError(404, "hls_segment_not_found", "HLS segment was not found");
    }
    const segmentPath = join(job.directory, asset);
    const details = await waitForHlsStat(segmentPath, job);
    const range = parseSingleRange(req.headers.range, details.size);
    if (range?.invalid) {
      res.writeHead(416, streamHeaders(req, {
        "Content-Range": `bytes */${details.size}`,
        "Content-Length": "0",
      }));
      res.end();
      return;
    }

    const selected = range || { start: 0, end: details.size - 1 };
    const contentLength = selected.end - selected.start + 1;
    const status = range ? 206 : 200;
    const headers = streamHeaders(req, {
      "Accept-Ranges": "bytes",
      "Content-Type": "video/mp2t",
      "Content-Length": String(contentLength),
      ...(range ? { "Content-Range": `bytes ${selected.start}-${selected.end}/${details.size}` } : {}),
    });
    if (req.method === "HEAD") {
      res.writeHead(status, headers);
      res.end();
      return;
    }

    let source;
    let release;
    try {
      release = claimStream(session, () => source?.destroy?.());
      source = createFsReadStream(segmentPath, selected);
    } catch (error) {
      release?.();
      throw error;
    }
    res.writeHead(status, headers);
    source.once("error", (error) => res.destroy(error));
    source.once("end", release);
    res.once("close", release);
    source.pipe(res);
  }

  async function handleRequest(req, res) {
    if (closed) throw new HttpError(503, "bridge_closed", "bridge is shutting down");
    if (!requestHostAllowed(req)) {
      throw new HttpError(421, "invalid_host", "request Host is not the loopback bridge");
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      requireApiOrigin(req);
      res.writeHead(204, {
        ...corsHeaders(req),
        "Access-Control-Allow-Methods": "GET, HEAD, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Range, X-Bridge-Token",
        "Access-Control-Max-Age": "600",
        "Content-Length": "0",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && path === "/v1/capabilities") {
      requireApiOrigin(req);
      json(res, 200, {
        bridge: {
          version: BRIDGE_VERSION,
          bootstrapToken,
          bind: address(),
          allowedOrigins: [...allowedOrigins],
          sessionTtlMs,
          limits: { sessions: maxSessions, streams: maxStreams, transcodes: maxTranscodes },
        },
        transports: {
          tcpPeers: true,
          udpTrackers: true,
          httpTrackers: true,
          dht: Boolean(client.dht),
          webRtcPeers: Boolean(client.tracker?.wrtc || globalThis.WRTC),
        },
        playback: {
          rawHttpRange: true,
          hls: {
            available: ffmpeg.available,
            type: "application/vnd.apple.mpegurl",
            segmentType: "video/mp2t",
            segmentDurationSeconds: 1,
            slidingWindowSegments: 24,
            boundedDiskBytes: hlsMaxBytes,
            ffmpegVersion: ffmpeg.version,
          },
          remux: {
            available: ffmpeg.available,
            type: "video/mp4",
            videoCodec: "copy",
            audioCodec: "copy",
            supportsRange: false,
            ffmpegVersion: ffmpeg.version,
          },
          transcode: {
            available: ffmpeg.available,
            type: "video/mp4",
            videoCodec: "h264",
            audioCodec: "aac",
            supportsRange: false,
            ffmpegVersion: ffmpeg.version,
          },
        },
      }, corsHeaders(req));
      return;
    }

    if (req.method === "POST" && path === "/v1/sessions") {
      requireApiOrigin(req);
      requireBootstrap(req);
      const body = await readJson(req);
      const magnet = validateMagnet(body?.magnet);
      const session = startSession(magnet);
      json(res, 202, sessionEnvelope(req, session, true), corsHeaders(req));
      return;
    }

    const hlsMatch = /^\/v1\/sessions\/([^/]+)\/files\/(\d+)\/hls\/([^/]+)$/.exec(path);
    if (hlsMatch) {
      if (!["GET", "HEAD"].includes(req.method)) {
        throw new HttpError(405, "method_not_allowed", "HLS endpoints accept GET or HEAD");
      }
      const [, hlsSessionId, hlsFileIndex, asset] = hlsMatch;
      const session = getSession(hlsSessionId);
      if (req.headers.origin && !originAllowed(req)) {
        throw new HttpError(403, "origin_denied", "request Origin is not an allowed localhost app");
      }
      requireSession(req, session, url.searchParams.get("token"));
      touch(session);
      const file = findFile(session, hlsFileIndex);
      await serveHls(req, res, session, file, Number(hlsFileIndex), asset);
      return;
    }

    const match = /^\/v1\/sessions\/([^/]+)(?:\/files\/(\d+)\/(stream|remux|transcode))?$/.exec(path);
    if (!match) throw new HttpError(404, "not_found", "bridge endpoint was not found");

    const [, id, fileIndex, operation] = match;
    const session = getSession(id);

    if (operation) {
      if (!["GET", "HEAD"].includes(req.method)) {
        throw new HttpError(405, "method_not_allowed", "stream endpoints accept GET or HEAD");
      }
      if (req.headers.origin && !originAllowed(req)) {
        throw new HttpError(403, "origin_denied", "request Origin is not an allowed localhost app");
      }
      requireSession(req, session, url.searchParams.get("token"));
      touch(session);
      const file = findFile(session, fileIndex);
      if (operation === "stream") serveRaw(req, res, session, file);
      else serveFfmpeg(req, res, session, file, operation);
      return;
    }

    requireApiOrigin(req);
    requireSession(req, session);
    touch(session);
    if (req.method === "GET") {
      json(res, 200, sessionEnvelope(req, session), corsHeaders(req));
      return;
    }
    if (req.method === "DELETE") {
      await destroySession(session);
      json(res, 204, null, corsHeaders(req));
      return;
    }
    throw new HttpError(405, "method_not_allowed", "session endpoint accepts GET or DELETE");
  }

  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (session.resources.size === 0 && now - session.lastAccessAt >= sessionTtlMs) {
        void destroySession(session);
      }
    }
  }, Math.min(30_000, Math.max(1_000, Math.floor(sessionTtlMs / 2))));
  sweepTimer.unref?.();

  client.on?.("error", (error) => {
    for (const session of sessions.values()) {
      session.warnings.push({
        at: new Date().toISOString(),
        message: `torrent client warning: ${errorMessage(error)}`,
      });
      session.warnings = session.warnings.slice(-MAX_WARNINGS);
    }
  });

  return {
    server,
    client,
    sessions,
    address,
    async listen(port = Number(process.env.BRIDGE_PORT) || DEFAULT_PORT) {
      if (closed) throw new Error("bridge is closed");
      await new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        server.once("error", onError);
        server.listen(port, LOOPBACK_HOST, () => {
          server.removeListener("error", onError);
          resolve();
        });
      });
      return address();
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(sweepTimer);
      await Promise.all([...sessions.values()].map((session) => destroySession(session)));
      await new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
      await destroyClient(client);
    },
  };
}
