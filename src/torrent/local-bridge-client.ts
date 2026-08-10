import { mapAndSortFiles } from "./torrent-files";
import { prepareBrowserTorrentId } from "./tracker-pool";
import type {
  RuntimeTorrentFile,
  StreamSource,
  TorrentFileView,
  TorrentMetrics,
  TorrentServiceHandlers,
  TorrentSource,
  TorrentSourceTransports,
} from "./torrent-types";

const DEFAULT_BRIDGE_ORIGIN = "http://127.0.0.1:41780";
const TRUSTED_APP_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
// First loopback access can include a browser CORS/PNA preflight and should not
// silently fall back to WebRTC merely because that handshake is cold.
const CAPABILITY_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 750;
const NO_PEER_NOTICE_MS = 12_000;

interface BridgeCapabilities {
  bridge: {
    version: string;
    bootstrapToken: string;
  };
  transports: {
    tcpPeers: boolean;
    udpTrackers: boolean;
    httpTrackers: boolean;
    dht: boolean;
  };
  playback: {
    rawHttpRange: boolean;
    hls?: {
      available: boolean;
      type: string;
    };
    remux: {
      available: boolean;
      type: string;
      supportsRange: boolean;
    };
    transcode: {
      available: boolean;
      type: string;
      supportsRange: boolean;
    };
  };
}

interface BridgeStreamDescriptor {
  available: boolean;
  type: string;
  supportsRange: boolean;
  url: string | null;
  note?: string;
}

interface BridgeFile {
  id: string;
  index: number;
  name: string;
  path: string;
  length: number;
  type: string;
  downloaded: number;
  progress: number;
  streams: {
    raw: BridgeStreamDescriptor;
    hls?: BridgeStreamDescriptor;
    remux: BridgeStreamDescriptor;
    transcode: BridgeStreamDescriptor;
  };
}

interface BridgeTorrentStatus {
  infoHash: string;
  name: string | null;
  length: number | null;
  files: number;
  numPeers: number;
  downloaded: number;
  received: number;
  uploaded: number;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  timeRemaining: number | null;
  ratio: number;
  done: boolean;
}

interface BridgeSession {
  id: string;
  token?: string;
  state: "resolving" | "ready" | "error";
  statusUrl: string;
  metadataReceivedAt: string | null;
  error: { code: string; message: string } | null;
  warnings: Array<{ at: string; message: string }>;
  torrent: BridgeTorrentStatus | null;
  files: BridgeFile[];
}

interface BridgeSessionEnvelope {
  session: BridgeSession;
}

interface ActiveBridgeFile {
  response: BridgeFile;
  view: TorrentFileView;
}

export function canProbeLocalBridge(): boolean {
  if (typeof window === "undefined") return false;
  return TRUSTED_APP_ORIGINS.has(window.location.origin);
}

async function readBridgeError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
    };
    if (body.error?.message) return new Error(body.error.message);
  } catch {
    // A stopped or incompatible helper can return a non-JSON network response.
  }
  return new Error(`${fallback} (${response.status})`);
}

function runtimeFileFromBridge(file: BridgeFile): RuntimeTorrentFile {
  return {
    name: file.name,
    path: file.path,
    length: file.length,
    type: file.type,
    downloaded: file.downloaded,
    progress: file.progress,
    streamURL: file.streams.raw.url || "",
    async blob(options) {
      const headers = new Headers();
      if (options?.start !== undefined || options?.end !== undefined) {
        const start = Math.max(0, options.start || 0);
        const end = options.end === undefined ? "" : String(Math.max(start, options.end - 1));
        headers.set("Range", `bytes=${start}-${end}`);
      }
      const response = await fetch(file.streams.raw.url || "", { headers });
      if (!response.ok && response.status !== 206) {
        throw await readBridgeError(response, "The local bridge could not read this file");
      }
      return response.blob();
    },
  };
}

function mapBridgeFiles(files: BridgeFile[]): ActiveBridgeFile[] {
  const responsesByPath = new Map(files.map((file) => [file.path, file]));
  return mapAndSortFiles(files.map(runtimeFileFromBridge)).map((view) => {
    const response = responsesByPath.get(view.path) as BridgeFile;
    return {
      view:
        view.category === "video" && response.streams.hls?.available
          ? { ...view, compatibility: "likely" as const }
          : view,
      response,
    };
  });
}

function needsContainerConversion(file: TorrentFileView): boolean {
  // `mapBridgeFiles` deliberately marks bridge-convertible video as browser
  // ready for the manifest UI. Base routing on the original container instead
  // of that presentation flag, otherwise MKV would accidentally use `raw`.
  return (
    file.category === "video" &&
    !["mp4", "m4v", "webm"].includes(file.extension)
  );
}

/**
 * Optional localhost companion for conventional BitTorrent swarms.
 *
 * Only the local development app may probe the loopback helper. Hosted pages
 * never touch 127.0.0.1 automatically, so a missing companion cannot create a
 * misleading production console error.
 */
export class LocalTorrentBridgeClient {
  private handlers: TorrentServiceHandlers | null = null;
  private source: TorrentSource | null = null;
  private session: BridgeSession | null = null;
  private sessionToken: string | null = null;
  private files = new Map<string, ActiveBridgeFile>();
  private selectedPath: string | null = null;
  private pollTimer: number | null = null;
  private abortController: AbortController | null = null;
  private loadEpoch = 0;
  private readyEmitted = false;
  private noPeerNoticeEmitted = false;
  private startedAt = 0;
  private firstPeerAt: number | null = null;
  private firstByteAt: number | null = null;
  private lastDataAt = 0;
  private lastReceived = 0;
  private lastDownloaded = 0;
  private streamSelectedAt: number | null = null;
  private peakDownloadSpeed = 0;
  private sourceTransports: TorrentSourceTransports | undefined;

  async tryLoad(
    source: TorrentSource,
    handlers: TorrentServiceHandlers,
  ): Promise<boolean> {
    if (
      typeof source.value !== "string" ||
      !source.value.trim().toLowerCase().startsWith("magnet:?") ||
      !canProbeLocalBridge()
    ) {
      return false;
    }

    await this.destroyCurrent();
    this.handlers = handlers;
    this.source = source;
    this.sourceTransports = prepareBrowserTorrentId(source.value).sourceTransports;

    const capabilities = await this.probeCapabilities();
    if (!capabilities) {
      // A conventional-only source benefits from the native bridge when it is
      // present, but its absence must not block the browser fallback. The
      // browser client replaces unsupported routes with its bounded WSS pool,
      // which can still find WebRTC-capable seeders for this info hash.
      return false;
    }

    const epoch = ++this.loadEpoch;
    this.startedAt = Date.now();
    this.firstPeerAt = null;
    this.firstByteAt = null;
    this.lastDataAt = this.startedAt;
    this.lastReceived = 0;
    this.lastDownloaded = 0;
    this.streamSelectedAt = null;
    this.peakDownloadSpeed = 0;
    this.readyEmitted = false;
    this.noPeerNoticeEmitted = false;
    this.abortController = new AbortController();

    // Surface the chosen runtime before the first status poll so the loading
    // screen does not briefly claim that WebRTC/service-worker mode is active.
    handlers.onMetrics({
      transportMode: "native-bridge",
      peers: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      progress: 0,
      downloaded: 0,
      uploaded: 0,
      received: 0,
      peakDownloadSpeed: 0,
      timeToMetadataMs: null,
      timeToFirstPeerMs: null,
      timeToFirstByteMs: null,
      stalledForMs: 0,
      sourceTransports: this.sourceTransports,
    });

    handlers.onPhase(
      "initializing",
      "Connecting to the private localhost torrent bridge...",
    );

    let response: Response;
    try {
      response = await fetch(`${DEFAULT_BRIDGE_ORIGIN}/v1/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bridge-Token": capabilities.bridge.bootstrapToken,
        },
        body: JSON.stringify({ magnet: source.value }),
        signal: this.abortController.signal,
      });
    } catch (error) {
      if (epoch !== this.loadEpoch || (error instanceof DOMException && error.name === "AbortError")) {
        return true;
      }
      handlers.onPhase("failed", "The local torrent bridge disconnected.");
      handlers.onError(
        "The native bridge was detected but stopped before it could create a torrent session.",
      );
      return true;
    }

    if (!response.ok) {
      const error = await readBridgeError(response, "The local bridge rejected this torrent");
      handlers.onPhase("failed", "The local torrent bridge rejected the source.");
      handlers.onError(error.message);
      return true;
    }

    const envelope = (await response.json()) as BridgeSessionEnvelope;
    if (epoch !== this.loadEpoch) return true;
    this.session = envelope.session;
    this.sessionToken = envelope.session.token || null;
    if (!this.sessionToken) {
      handlers.onPhase("failed", "The local torrent bridge returned an invalid session.");
      handlers.onError("The bridge session did not include its private capability token.");
      return true;
    }

    handlers.onPhase(
      "metadata",
      "Native transport joined the UDP/TCP swarm; resolving metadata...",
    );
    await this.poll(epoch);
    return true;
  }

  private async probeCapabilities(): Promise<BridgeCapabilities | null> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), CAPABILITY_TIMEOUT_MS);
    try {
      const response = await fetch(`${DEFAULT_BRIDGE_ORIGIN}/v1/capabilities`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const capabilities = (await response.json()) as BridgeCapabilities;
      return capabilities.transports.tcpPeers && capabilities.playback.rawHttpRange
        ? capabilities
        : null;
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }

  private schedulePoll(epoch: number): void {
    this.clearPollTimer();
    this.pollTimer = window.setTimeout(() => void this.poll(epoch), POLL_INTERVAL_MS);
  }

  private async poll(epoch: number): Promise<void> {
    const session = this.session;
    const sessionToken = this.sessionToken;
    if (!session || !sessionToken || epoch !== this.loadEpoch) return;

    try {
      const response = await fetch(session.statusUrl, {
        headers: { Authorization: `Bearer ${sessionToken}` },
        cache: "no-store",
        signal: this.abortController?.signal,
      });
      if (!response.ok) {
        throw await readBridgeError(response, "The local bridge status request failed");
      }
      const envelope = (await response.json()) as BridgeSessionEnvelope;
      if (epoch !== this.loadEpoch) return;
      this.session = { ...envelope.session, token: sessionToken };
      this.emitSnapshot(this.session);

      if (this.session.state === "error") {
        this.clearPollTimer();
        this.handlers?.onPhase("failed", "The native torrent session stopped.");
        this.handlers?.onError(
          this.session.error?.message || "The native torrent bridge could not open this source.",
        );
        return;
      }
      this.schedulePoll(epoch);
    } catch (error) {
      if (epoch !== this.loadEpoch || (error instanceof DOMException && error.name === "AbortError")) {
        return;
      }
      this.clearPollTimer();
      this.handlers?.onPhase("failed", "The local torrent bridge disconnected.");
      this.handlers?.onError(
        error instanceof Error ? error.message : "The local torrent bridge disconnected.",
      );
    }
  }

  private emitSnapshot(session: BridgeSession): void {
    const torrent = session.torrent;
    if (!torrent) return;

    const now = Date.now();
    if (torrent.numPeers > 0 && this.firstPeerAt === null) {
      this.firstPeerAt = now;
    }
    if (torrent.received > this.lastReceived) {
      this.lastReceived = torrent.received;
    }
    if (
      this.streamSelectedAt !== null &&
      torrent.downloaded > this.lastDownloaded
    ) {
      if (this.firstByteAt === null) this.firstByteAt = now;
      this.lastDataAt = now;
    }
    this.lastDownloaded = torrent.downloaded;
    const currentDownloadSpeed = Number.isFinite(torrent.downloadSpeed)
      ? Math.max(0, torrent.downloadSpeed)
      : 0;
    this.peakDownloadSpeed = Math.max(
      this.peakDownloadSpeed,
      currentDownloadSpeed,
    );

    const activeFiles = mapBridgeFiles(session.files);
    this.files = new Map(activeFiles.map((file) => [file.view.path, file]));
    const selected = this.selectedPath ? this.files.get(this.selectedPath) : null;
    const latestWarning = session.warnings.at(-1)?.message || null;
    const metrics: TorrentMetrics = {
      transportMode: "native-bridge",
      peers: torrent.numPeers,
      downloadSpeed: currentDownloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      progress: torrent.progress,
      downloaded: torrent.downloaded,
      uploaded: torrent.uploaded,
      received: torrent.received,
      ratio: torrent.ratio,
      timeRemaining: torrent.timeRemaining,
      selectedFileProgress: selected?.response.progress ?? null,
      selectedFileDownloaded: selected?.response.downloaded ?? null,
      peakDownloadSpeed: this.peakDownloadSpeed,
      timeToMetadataMs: session.metadataReceivedAt
        ? new Date(session.metadataReceivedAt).getTime() - this.startedAt
        : null,
      timeToFirstPeerMs:
        this.firstPeerAt === null ? null : this.firstPeerAt - this.startedAt,
      timeToFirstByteMs:
        this.firstByteAt === null ? null : this.firstByteAt - this.startedAt,
      stalledForMs:
        this.streamSelectedAt === null || selected?.response.progress === 1
          ? 0
          : Math.max(0, now - this.lastDataAt),
      sessionWarnings: session.warnings.length,
      lastWarning: latestWarning,
      sourceTransports: this.sourceTransports,
    };
    this.handlers?.onMetrics(metrics);

    if (!this.readyEmitted && session.state === "ready") {
      this.readyEmitted = true;
      this.handlers?.onPhase("ready", "Torrent metadata received through the native bridge.");
      this.handlers?.onReady(
        {
          infoHash: torrent.infoHash,
          name: torrent.name || this.source?.label || "Untitled torrent",
          length: torrent.length || 0,
        },
        activeFiles.map((file) => file.view),
      );
    }

    if (
      !this.noPeerNoticeEmitted &&
      torrent.numPeers === 0 &&
      Date.now() - this.startedAt >= NO_PEER_NOTICE_MS
    ) {
      this.noPeerNoticeEmitted = true;
      this.handlers?.onNoPeers(
        "The native bridge reached the conventional tracker network, but no payload peer has answered yet.",
      );
    }
  }

  getStream(path: string): StreamSource {
    const activeFile = this.files.get(path);
    if (!activeFile) throw new Error("That file is no longer available.");
    const { response, view } = activeFile;
    const converted = needsContainerConversion(view);
    let playbackKind: NonNullable<StreamSource["playbackKind"]> = "direct";
    let descriptor = response.streams.raw;
    if (converted && response.streams.hls?.available) {
      playbackKind = "hls";
      descriptor = response.streams.hls;
    } else if (converted && response.streams.remux.available) {
      playbackKind = "remux";
      descriptor = response.streams.remux;
    } else if (converted) {
      playbackKind = "transcode";
      descriptor = response.streams.transcode;
    }
    if (!descriptor.available || !descriptor.url) {
      throw new Error(
        converted
          ? "The local bridge cannot prepare this container for browser playback."
          : "The local bridge did not provide a stream for this file.",
      );
    }

    this.selectedPath = path;
    this.streamSelectedAt = Date.now();
    this.firstByteAt = null;
    this.lastDataAt = this.streamSelectedAt;
    this.lastDownloaded = this.session?.torrent?.downloaded || 0;
    this.handlers?.onPhase(
      "streaming",
      playbackKind === "hls"
        ? "Local HLS delivery active through the localhost bridge."
        : playbackKind === "remux"
          ? "Fragmented MP4 remux active through the localhost bridge."
          : playbackKind === "transcode"
            ? "Live codec conversion active through the localhost bridge."
            : "Native bridge range stream active.",
    );
    return {
      url: descriptor.url,
      mime: descriptor.type,
      playbackKind,
      streamType: playbackKind === "hls" ? "live:dvr" : "on-demand",
      file: converted
        ? { ...view, mime: descriptor.type, compatibility: "likely" }
        : view,
    };
  }

  async readTextFile(path: string): Promise<string> {
    const activeFile = this.files.get(path);
    if (!activeFile) throw new Error("Subtitle file not found.");
    if (activeFile.view.length > 8 * 1024 * 1024) {
      throw new Error("Subtitle files must be smaller than 8 MB.");
    }
    const response = await fetch(activeFile.response.streams.raw.url || "");
    if (!response.ok) {
      throw await readBridgeError(response, "The local bridge could not read this subtitle");
    }
    return response.text();
  }

  async retry(): Promise<void> {
    if (!this.source || !this.handlers) return;
    const source = this.source;
    const handlers = this.handlers;
    await this.tryLoad(source, handlers);
  }

  async destroyCurrent(): Promise<void> {
    this.loadEpoch += 1;
    this.clearPollTimer();
    this.abortController?.abort();
    this.abortController = null;
    const session = this.session;
    const sessionToken = this.sessionToken;
    this.session = null;
    this.sessionToken = null;
    this.files.clear();
    this.selectedPath = null;
    this.readyEmitted = false;
    this.noPeerNoticeEmitted = false;
    this.firstPeerAt = null;
    this.firstByteAt = null;
    this.lastDataAt = 0;
    this.lastReceived = 0;
    this.lastDownloaded = 0;
    this.streamSelectedAt = null;
    this.peakDownloadSpeed = 0;

    if (session && sessionToken) {
      try {
        await fetch(session.statusUrl, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${sessionToken}` },
          keepalive: true,
        });
      } catch {
        // The helper may already have stopped; its process teardown clears all sessions.
      }
    }
  }

  async destroy(): Promise<void> {
    await this.destroyCurrent();
    this.handlers = null;
    this.source = null;
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
