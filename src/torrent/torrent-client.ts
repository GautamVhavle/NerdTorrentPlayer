import { mapAndSortFiles } from "./torrent-files";
import { LocalTorrentBridgeClient } from "./local-bridge-client";
import {
  OFFICIAL_WEBTORRENT_TRACKERS,
  getParsedTorrentFallbacks,
  inspectTorrentPrivacy,
  prepareBrowserTorrentId,
  shouldPreferNativeTransport,
  uniqueSecureTrackers,
} from "./tracker-pool";
import type { PreparedBrowserTorrentId } from "./tracker-pool";
import type {
  RuntimeTorrent,
  RuntimeTorrentFile,
  RuntimeTrackerClient,
  RuntimeTrackerUpdate,
  RuntimeWebTorrentClient,
  RuntimeWire,
  StreamSource,
  TorrentFileView,
  TorrentMeta,
  TorrentMetrics,
  TorrentServiceHandlers,
  TorrentSource,
  TorrentSourceTransports,
  TrackerDiagnostic,
} from "./torrent-types";

const MAGNET_PATTERN = /^magnet:\?(.+&)?xt=urn:btih:[a-z0-9]{32,40}(&|$)/i;
const MAX_REANNOUNCE_ATTEMPTS = 3;
const MAX_TRACKER_BIND_ATTEMPTS = 8;
const REANNOUNCE_BACKOFF_MS = [12_000, 30_000, 75_000] as const;
const MIN_REANNOUNCE_GAP_MS = 10_000;
const NO_PEER_NOTICE_GAP_MS = 20_000;

const SINTEL_INFO_HASH = "08ada5a7a6183aae1e09d831df6748d566095a10";

/** A legal, stable test torrent maintained by the WebTorrent project. */
export const SINTEL_DEMO_MAGNET = [
  `magnet:?xt=urn:btih:${SINTEL_INFO_HASH}`,
  "dn=Sintel",
  ...OFFICIAL_WEBTORRENT_TRACKERS.map(
    (tracker) => `tr=${encodeURIComponent(tracker)}`,
  ),
  `ws=${encodeURIComponent("https://webtorrent.io/torrents/")}`,
  `xs=${encodeURIComponent("https://webtorrent.io/torrents/sintel.torrent")}`,
].join("&");

export const SINTEL_DEMO_SOURCE: TorrentSource = {
  value: SINTEL_DEMO_MAGNET,
  label: "Sintel — official WebTorrent demo",
};

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "The torrent could not be opened in this browser.";
}

function messageFromError(error: unknown): string {
  const message = rawErrorMessage(error);
  if (/webrtc.*(?:not supported|unavailable)|no webrtc/i.test(message)) {
    return "This browser does not provide the WebRTC features WebTorrent needs.";
  }
  if (/service.?worker|secure context/i.test(message)) {
    return "The local streaming bridge is unavailable. Open the app over HTTPS or localhost and try again.";
  }
  return message;
}

function isRecoverableConnectivityError(error: unknown): boolean {
  return /(?:webrtc|rtcpeerconnection|ice|candidate|data.?channel|connection error|websocket|tracker|socket|networkerror|econn|timed?\s*out|disconnected)/i.test(
    rawErrorMessage(error),
  );
}

function isWebRtcWarning(error: unknown): boolean {
  return /(?:webrtc|rtcpeerconnection|ice|candidate|data.?channel|connection error)/i.test(
    rawErrorMessage(error),
  );
}

function getPeerConnectionBudget(): number {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;

  if (cores <= 2 || (memory !== undefined && memory <= 2)) return 55;
  if (cores >= 8 && (memory === undefined || memory >= 8)) return 80;
  return 64;
}

function getStoreCacheSlots(): number {
  const memory = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  if (memory !== undefined && memory <= 2) return 20;
  if (memory !== undefined && memory >= 8) return 40;
  return 28;
}

function safeWireDownloadSpeed(wire: RuntimeWire): number {
  try {
    return wire.downloadSpeed?.() || 0;
  } catch {
    return 0;
  }
}

interface PreparedTorrentLoad
  extends Omit<PreparedBrowserTorrentId, "value"> {
  value: string | Uint8Array;
}

async function prepareTorrentIdForLoad(
  value: string | Uint8Array,
): Promise<PreparedTorrentLoad> {
  const prepared = prepareBrowserTorrentId(value);
  if (typeof value === "string") return prepared;

  // Decode only far enough to inspect the private bit before tracker setup.
  // WebTorrent performs the authoritative parse when the original bytes are
  // added. Malformed/unknown inputs stay conservative and receive no public
  // fallbacks until WebTorrent surfaces the validation error.
  const privacy = await inspectTorrentPrivacy(value);
  if (privacy === null) return prepared;
  const trackers = getParsedTorrentFallbacks(privacy);
  return {
    value,
    trackers,
    publicFallbacksAdded: trackers.length > 0,
    sourceTransports: prepared.sourceTransports,
  };
}

export function validateMagnet(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return "Paste a magnet link to continue.";
  if (!normalized.toLowerCase().startsWith("magnet:?")) {
    return "That does not look like a magnet link.";
  }
  if (!MAGNET_PATTERN.test(normalized)) {
    return "This magnet link is missing a valid BitTorrent info hash.";
  }
  return null;
}

export async function sourceFromTorrentFile(file: File): Promise<TorrentSource> {
  if (!file.name.toLowerCase().endsWith(".torrent")) {
    throw new Error("Choose a .torrent file.");
  }

  if (file.size > 20 * 1024 * 1024) {
    throw new Error("That torrent file is unusually large. Choose one under 20 MB.");
  }

  return {
    value: new Uint8Array(await file.arrayBuffer()),
    label: file.name,
  };
}

class TorrentClientService {
  private client: RuntimeWebTorrentClient | null = null;
  private clientPromise: Promise<RuntimeWebTorrentClient> | null = null;
  private clientEpoch = 0;
  private torrent: RuntimeTorrent | null = null;
  private handlers: TorrentServiceHandlers | null = null;
  private source: TorrentSource | null = null;
  private fileMap = new Map<string, RuntimeTorrentFile>();
  private selectedFile: RuntimeTorrentFile | null = null;
  private metricsTimer: number | null = null;
  private metadataTimer: number | null = null;
  private peerTimer: number | null = null;
  private reannounceTimer: number | null = null;
  private loadToken = 0;
  private trackerBinding: {
    tracker: RuntimeTrackerClient;
    onUpdate: (...args: unknown[]) => void;
    onPeer: (...args: unknown[]) => void;
  } | null = null;
  private trackerDiagnostics = new Map<string, TrackerDiagnostic>();
  private loadStartedAt = 0;
  private metadataReceivedAt: number | null = null;
  private firstPeerAt: number | null = null;
  private streamSelectedAt: number | null = null;
  private firstByteAt: number | null = null;
  private lastDataAt: number | null = null;
  private previousDownloaded = 0;
  private peakDownloadSpeed = 0;
  private trackerAnnounces = 0;
  private trackerPeerCandidates = 0;
  private trackerWarnings = 0;
  private recoverableWebRtcErrors = 0;
  private publicTrackerFallbacks = false;
  private reannounceAttempts = 0;
  private trackerBindAttempts = 0;
  private lastReannounceAt = 0;
  private lastNoPeerNoticeAt = 0;
  private lastWarning: string | null = null;
  private sourceTransports: TorrentSourceTransports = {
    wssTrackers: 0,
    udpTrackers: 0,
    httpTrackers: 0,
    otherTrackers: 0,
    webSeeds: 0,
    exactSources: 0,
  };

  private async ensureClient(): Promise<RuntimeWebTorrentClient> {
    if (this.client) return this.client;
    if (this.clientPromise) return this.clientPromise;

    const epoch = this.clientEpoch;
    const initializingClient = (async () => {
      if (typeof window === "undefined") {
        throw new Error("WebTorrent can only run in a browser.");
      }

      if (!window.isSecureContext && window.location.hostname !== "localhost") {
        throw new Error(
          "A secure context is required for WebRTC and service-worker streaming.",
        );
      }

      if (!("serviceWorker" in navigator)) {
        throw new Error(
          "This browser cannot create the local streaming bridge required for playback.",
        );
      }

      const [{ default: WebTorrent }] = await Promise.all([
        import("webtorrent/dist/webtorrent.min.js"),
        navigator.serviceWorker.register("/sw.min.js", { scope: "/" }),
      ]);
      const RuntimeWebTorrent = WebTorrent as typeof WebTorrent & {
        WEBRTC_SUPPORT?: boolean;
      };

      if (RuntimeWebTorrent.WEBRTC_SUPPORT === false) {
        throw new Error("WebRTC is not supported by this browser.");
      }

      const readyRegistration = await navigator.serviceWorker.ready;
      if (epoch !== this.clientEpoch) {
        throw new Error("P2P engine initialization was cancelled.");
      }
      const client = new RuntimeWebTorrent({
        maxConns: getPeerConnectionBudget(),
        dht: false,
        lsd: false,
        utPex: false,
        utp: false,
        natUpnp: false,
        natPmp: false,
        webSeeds: true,
        downloadLimit: -1,
        uploadLimit: -1,
      });

      try {
        client.createServer({
          controller: readyRegistration,
          origin: false,
        });
      } catch (error) {
        try {
          client.destroy();
        } catch {
          // The constructor may have already torn down after a bridge failure.
        }
        throw error;
      }

      client.on("error", (error: unknown) => {
        if (isRecoverableConnectivityError(error)) {
          this.recordWarning(error);
          if (this.torrent) {
            this.scheduleReannounce(this.torrent, this.loadToken);
          }
          return;
        }
        this.handlers?.onPhase("failed", "The local P2P engine stopped.");
        this.handlers?.onError(messageFromError(error));
      });

      this.client = client;
      return client;
    })();
    const guardedClient = initializingClient.catch((error) => {
      if (this.clientPromise === guardedClient) this.clientPromise = null;
      throw error;
    });
    this.clientPromise = guardedClient;

    return this.clientPromise;
  }

  async load(
    source: TorrentSource,
    handlers: TorrentServiceHandlers,
  ): Promise<void> {
    await this.destroyCurrent();
    const token = ++this.loadToken;
    const prepared = await prepareTorrentIdForLoad(source.value);
    if (token !== this.loadToken) return;
    this.handlers = handlers;
    this.source = source;
    this.resetSessionDiagnostics(
      prepared.trackers,
      prepared.publicFallbacksAdded,
      prepared.sourceTransports,
    );
    handlers.onPhase("initializing", "Starting the browser P2P engine...");

    try {
      const client = await this.ensureClient();
      if (token !== this.loadToken) return;

      handlers.onPhase("metadata", "Contacting secure WebTorrent trackers...");
      const torrent = client.add(
        prepared.value,
        {
          announce: prepared.trackers,
          deselect: true,
          strategy: "sequential",
          destroyStoreOnDestroy: true,
          noPeersIntervalTime: 8,
          maxWebConns: 8,
          storeCacheSlots: getStoreCacheSlots(),
        },
        (readyTorrent) => {
          if (token !== this.loadToken) return;
          this.handleReady(readyTorrent);
        },
      );

      this.torrent = torrent;
      this.attachTorrentEvents(torrent, token);
      this.beginMetrics(torrent, token);
      this.scheduleReannounce(torrent, token);
      this.metadataTimer = window.setTimeout(() => {
        if (token !== this.loadToken || torrent.ready) return;
        handlers.onPhase(
          "waiting",
          "Tracker scan active; waiting for a WebRTC peer with metadata...",
        );
        handlers.onNoPeers(
          "Metadata is taking longer than usual. Only WebRTC-capable peers and CORS-enabled web seeds are reachable from a browser.",
        );
      }, 30_000);
    } catch (error) {
      if (token !== this.loadToken) return;
      handlers.onPhase("failed", "Connection failed.");
      handlers.onError(messageFromError(error));
    }
  }

  private attachTorrentEvents(torrent: RuntimeTorrent, token: number): void {
    torrent.on("infoHash", () => {
      if (token !== this.loadToken) return;
      this.mergeTrackerDiagnostics(torrent.announce || []);
      queueMicrotask(() => this.bindTrackerDiagnostics(torrent, token));
    });

    torrent.on("trackerAnnounce", () => {
      if (token !== this.loadToken) return;
      this.trackerAnnounces += 1;
      this.bindTrackerDiagnostics(torrent, token);
    });

    torrent.on("wire", (wireValue) => {
      if (token !== this.loadToken) return;
      const wire = wireValue as RuntimeWire;
      const now = Date.now();
      if (this.firstPeerAt === null) this.firstPeerAt = now;
      this.reannounceAttempts = 0;
      this.clearReannounceTimer();

      wire.once?.("close", () => {
        queueMicrotask(() => {
          if (
            token === this.loadToken &&
            this.torrent === torrent &&
            torrent.numPeers === 0
          ) {
            this.scheduleReannounce(torrent, token, 4_000);
          }
        });
      });
    });

    torrent.on("download", () => {
      if (token !== this.loadToken || this.streamSelectedAt === null) return;
      const now = Date.now();
      this.lastDataAt = now;
      if (this.firstByteAt === null) this.firstByteAt = now;
    });

    torrent.on("warning", (error) => {
      if (token !== this.loadToken) return;
      this.recordWarning(error);
      if (torrent.numPeers === 0) {
        this.scheduleReannounce(torrent, token);
      }
    });

    torrent.on("error", (error) => {
      if (token !== this.loadToken) return;
      this.clearTimers();
      this.unbindTrackerDiagnostics();
      if (this.torrent === torrent) this.torrent = null;
      this.fileMap.clear();
      this.selectedFile = null;
      this.handlers?.onPhase("failed", "This torrent session stopped.");
      this.handlers?.onError(messageFromError(error));
    });

    torrent.on("noPeers", () => {
      if (token !== this.loadToken) return;
      this.scheduleReannounce(torrent, token);

      const now = Date.now();
      if (now - this.lastNoPeerNoticeAt < NO_PEER_NOTICE_GAP_MS) return;
      this.lastNoPeerNoticeAt = now;
      if (!torrent.ready) {
        this.handlers?.onPhase(
          "waiting",
          "Waiting for a browser-compatible peer with metadata...",
        );
      }
      this.handlers?.onNoPeers(
        this.recoverableWebRtcErrors > 0
          ? "Some WebRTC candidates could not connect, which is normal. The engine is rotating through the remaining peers and trackers."
          : "No browser-compatible peer has answered yet. The engine will reannounce with safe backoff while this tab stays open.",
      );
    });

    queueMicrotask(() => this.bindTrackerDiagnostics(torrent, token));
  }

  private handleReady(torrent: RuntimeTorrent): void {
    this.clearMetadataTimer();
    this.metadataReceivedAt = Date.now();
    this.mergeTrackerDiagnostics(torrent.announce || []);
    this.bindTrackerDiagnostics(torrent, this.loadToken);
    const files = mapAndSortFiles(torrent.files);
    this.fileMap = new Map(torrent.files.map((file) => [file.path, file]));

    const meta: TorrentMeta = {
      infoHash: torrent.infoHash,
      name: torrent.name || this.source?.label || "Untitled torrent",
      length: torrent.length,
    };

    this.handlers?.onPhase("ready", "Torrent metadata received.");
    this.handlers?.onReady(meta, files);

    this.peerTimer = window.setTimeout(() => {
      if (this.torrent === torrent && torrent.numPeers === 0) {
        this.handlers?.onNoPeers(
          "The file index is ready. Waiting for a WebRTC peer or web seed that can deliver the selected file.",
        );
        this.scheduleReannounce(torrent, this.loadToken, 2_000);
      }
    }, 10_000);
  }

  private beginMetrics(torrent: RuntimeTorrent, token: number): void {
    this.clearMetricsTimer();
    const emit = () => {
      if (token !== this.loadToken || this.torrent !== torrent) return;
      const now = Date.now();
      const downloaded = torrent.downloaded || 0;
      if (
        this.streamSelectedAt !== null &&
        downloaded > this.previousDownloaded
      ) {
        this.lastDataAt = now;
        if (this.firstByteAt === null) this.firstByteAt = now;
      }
      this.previousDownloaded = downloaded;
      this.peakDownloadSpeed = Math.max(
        this.peakDownloadSpeed,
        torrent.downloadSpeed || 0,
      );

      const wires = torrent.wires || [];
      const trackers = [...this.trackerDiagnostics.values()]
        .sort((a, b) => a.url.localeCompare(b.url))
        .map((tracker) => ({
          ...tracker,
          status:
            tracker.status === "connecting" &&
            now - this.loadStartedAt >= 45_000
              ? ("degraded" as const)
              : tracker.status,
        }));
      const timeRemaining = torrent.timeRemaining;
      const ratio = torrent.ratio;
      const reportedTrackerSeeders = trackers.reduce(
        (total, tracker) => total + (tracker.seeders ?? 0),
        0,
      );
      const reportedTrackerLeechers = trackers.reduce(
        (total, tracker) => total + (tracker.leechers ?? 0),
        0,
      );
      const metrics: TorrentMetrics = {
        transportMode: "browser",
        peers: torrent.numPeers || 0,
        downloadSpeed: torrent.downloadSpeed || 0,
        uploadSpeed: torrent.uploadSpeed || 0,
        progress: torrent.progress || 0,
        downloaded,
        uploaded: torrent.uploaded || 0,
        received: torrent.received ?? 0,
        ratio: Number.isFinite(ratio) ? ratio : 0,
        timeRemaining:
          Number.isFinite(timeRemaining) && (timeRemaining || 0) >= 0
            ? timeRemaining || 0
            : null,
        selectedFileProgress: this.selectedFile?.progress ?? null,
        selectedFileDownloaded: this.selectedFile?.downloaded ?? null,
        connectedWebRtcPeers: wires.filter((wire) => wire.type === "webrtc")
          .length,
        connectedWebSeeds: wires.filter((wire) => wire.type === "webSeed")
          .length,
        activeDownloadPeers: wires.filter(
          (wire) => safeWireDownloadSpeed(wire) > 0,
        ).length,
        unchokedPeers: wires.filter((wire) => wire.peerChoking === false).length,
        trackerCount: trackers.length,
        responsiveTrackers: trackers.filter(
          (tracker) => tracker.status === "responding",
        ).length,
        trackerAnnounces: this.trackerAnnounces,
        reportedTrackerSeeders,
        reportedTrackerLeechers,
        reportedSwarmPopulation:
          reportedTrackerSeeders + reportedTrackerLeechers,
        trackerPeerCandidates: this.trackerPeerCandidates,
        trackerWarnings: this.trackerWarnings,
        recoverableWebRtcErrors: this.recoverableWebRtcErrors,
        publicTrackerFallbacks: this.publicTrackerFallbacks,
        reannounceAttempts: this.reannounceAttempts,
        reannounceLimit: MAX_REANNOUNCE_ATTEMPTS,
        trackerBindAttempts: this.trackerBindAttempts,
        trackerBindLimit: MAX_TRACKER_BIND_ATTEMPTS,
        sourceTransports: { ...this.sourceTransports },
        peakDownloadSpeed: this.peakDownloadSpeed,
        timeToMetadataMs:
          this.metadataReceivedAt === null
            ? null
            : this.metadataReceivedAt - this.loadStartedAt,
        timeToFirstPeerMs:
          this.firstPeerAt === null
            ? null
            : this.firstPeerAt - this.loadStartedAt,
        timeToFirstByteMs:
          this.firstByteAt === null
            ? null
            : this.firstByteAt - this.loadStartedAt,
        stalledForMs:
          this.streamSelectedAt === null || this.selectedFile?.progress === 1
            ? 0
            : now - (this.lastDataAt || this.streamSelectedAt),
        pieceLength: torrent.pieceLength || null,
        lastWarning: this.lastWarning,
        trackers,
      };
      this.handlers?.onMetrics(metrics);
    };

    emit();
    this.metricsTimer = window.setInterval(emit, 750);
  }

  private resetSessionDiagnostics(
    trackers: string[],
    publicTrackerFallbacks: boolean,
    sourceTransports: TorrentSourceTransports,
  ): void {
    this.loadStartedAt = Date.now();
    this.metadataReceivedAt = null;
    this.firstPeerAt = null;
    this.streamSelectedAt = null;
    this.firstByteAt = null;
    this.lastDataAt = null;
    this.previousDownloaded = 0;
    this.peakDownloadSpeed = 0;
    this.trackerAnnounces = 0;
    this.trackerPeerCandidates = 0;
    this.trackerWarnings = 0;
    this.recoverableWebRtcErrors = 0;
    this.publicTrackerFallbacks = publicTrackerFallbacks;
    this.reannounceAttempts = 0;
    this.trackerBindAttempts = 0;
    this.lastReannounceAt = 0;
    this.lastNoPeerNoticeAt = 0;
    this.lastWarning = null;
    this.sourceTransports = { ...sourceTransports };
    this.trackerDiagnostics.clear();
    this.mergeTrackerDiagnostics(trackers);
  }

  private mergeTrackerDiagnostics(trackers: Iterable<string>): void {
    for (const url of uniqueSecureTrackers(trackers)) {
      if (this.trackerDiagnostics.has(url)) continue;
      this.trackerDiagnostics.set(url, {
        url,
        status: "connecting",
        announces: 0,
        lastAnnounceAt: null,
        seeders: null,
        leechers: null,
      });
    }
  }

  private bindTrackerDiagnostics(
    torrent: RuntimeTorrent,
    token: number,
  ): boolean {
    if (token !== this.loadToken || this.torrent !== torrent) return false;
    const tracker = torrent.discovery?.tracker;
    if (!tracker || tracker.destroyed) return false;
    if (this.trackerBinding?.tracker === tracker) {
      this.trackerBindAttempts = 0;
      return true;
    }

    this.unbindTrackerDiagnostics();
    const onUpdate = (...args: unknown[]) => {
      if (token !== this.loadToken || this.torrent !== torrent) return;
      const update = (args[0] || {}) as RuntimeTrackerUpdate;
      if (!update.announce) return;
      const [url] = uniqueSecureTrackers([update.announce]);
      if (!url) return;
      this.mergeTrackerDiagnostics([url]);
      const diagnostic = this.trackerDiagnostics.get(url);
      if (!diagnostic) return;
      diagnostic.status = "responding";
      diagnostic.announces += 1;
      diagnostic.lastAnnounceAt = Date.now();
      diagnostic.seeders = Number.isFinite(update.complete)
        ? update.complete || 0
        : diagnostic.seeders;
      diagnostic.leechers = Number.isFinite(update.incomplete)
        ? update.incomplete || 0
        : diagnostic.leechers;
    };
    const onPeer = () => {
      if (token !== this.loadToken || this.torrent !== torrent) return;
      this.trackerPeerCandidates += 1;
    };

    tracker.on("update", onUpdate);
    tracker.on("peer", onPeer);
    this.trackerBinding = { tracker, onUpdate, onPeer };
    this.trackerBindAttempts = 0;
    return true;
  }

  private unbindTrackerDiagnostics(): void {
    if (!this.trackerBinding) return;
    const { tracker, onUpdate, onPeer } = this.trackerBinding;
    if (tracker.off) {
      tracker.off("update", onUpdate);
      tracker.off("peer", onPeer);
    } else {
      tracker.removeListener?.("update", onUpdate);
      tracker.removeListener?.("peer", onPeer);
    }
    this.trackerBinding = null;
  }

  private recordWarning(error: unknown): void {
    this.trackerWarnings += 1;
    if (isWebRtcWarning(error)) this.recoverableWebRtcErrors += 1;
    this.lastWarning = rawErrorMessage(error).slice(0, 240);
  }

  private scheduleReannounce(
    torrent: RuntimeTorrent,
    token: number,
    preferredDelay?: number,
  ): void {
    if (
      this.reannounceTimer !== null ||
      torrent.destroyed ||
      torrent.numPeers > 0 ||
      this.reannounceAttempts >= MAX_REANNOUNCE_ATTEMPTS ||
      this.trackerBindAttempts >= MAX_TRACKER_BIND_ATTEMPTS
    ) {
      return;
    }

    const backoff =
      REANNOUNCE_BACKOFF_MS[
        Math.min(this.reannounceAttempts, REANNOUNCE_BACKOFF_MS.length - 1)
      ];
    const cooldown = Math.max(
      0,
      MIN_REANNOUNCE_GAP_MS - (Date.now() - this.lastReannounceAt),
    );
    const delay = Math.max(preferredDelay ?? backoff, cooldown);

    this.reannounceTimer = window.setTimeout(() => {
      this.reannounceTimer = null;
      if (
        token !== this.loadToken ||
        this.torrent !== torrent ||
        torrent.destroyed ||
        torrent.numPeers > 0
      ) {
        return;
      }

      if (!this.bindTrackerDiagnostics(torrent, token)) {
        this.trackerBindAttempts += 1;
        if (this.trackerBindAttempts >= MAX_TRACKER_BIND_ATTEMPTS) {
          this.recordWarning(
            `Tracker diagnostics did not become available after ${MAX_TRACKER_BIND_ATTEMPTS} checks.`,
          );
          return;
        }
        this.scheduleReannounce(torrent, token, 2_000);
        return;
      }

      const tracker = torrent.discovery?.tracker;
      if (!tracker || tracker.destroyed) return;
      try {
        // The discovery client supplies the authoritative uploaded/downloaded/
        // left values, including the pre-metadata magnet state.
        tracker.update();
        this.lastReannounceAt = Date.now();
        this.reannounceAttempts += 1;
        this.scheduleReannounce(torrent, token);
      } catch (error) {
        this.recordWarning(error);
        this.reannounceAttempts += 1;
        this.scheduleReannounce(torrent, token);
      }
    }, delay);
  }

  /** Requests fresh offers without discarding downloaded pieces or metadata. */
  reannounce(): boolean {
    const torrent = this.torrent;
    if (!torrent || torrent.destroyed) return false;
    this.clearReannounceTimer();
    this.reannounceAttempts = 0;
    this.trackerBindAttempts = 0;
    this.scheduleReannounce(torrent, this.loadToken, 0);
    return true;
  }

  getStream(path: string): StreamSource {
    const runtimeFile = this.fileMap.get(path);
    if (!runtimeFile) throw new Error("That file is no longer available.");
    const files = mapAndSortFiles([runtimeFile]);
    const file = files[0];
    if (this.selectedFile && this.selectedFile !== runtimeFile) {
      this.selectedFile.deselect?.();
    }
    // A higher file selection priority keeps sequential playback ahead of any
    // subtitle/background reads. The service-worker stream marks seek ranges
    // critical as the media element requests them.
    runtimeFile.select?.(10);
    this.selectedFile = runtimeFile;
    this.streamSelectedAt = Date.now();
    this.firstByteAt = null;
    this.lastDataAt = null;
    this.previousDownloaded = this.torrent?.downloaded || 0;
    if (this.torrent?.numPeers === 0) {
      this.clearReannounceTimer();
      this.scheduleReannounce(this.torrent, this.loadToken, 2_000);
    }
    this.handlers?.onPhase("streaming", "Sequential stream priority active.");
    return {
      url: runtimeFile.streamURL,
      mime: normalizePlaybackMime(file),
      file,
    };
  }

  async readTextFile(path: string): Promise<string> {
    const runtimeFile = this.fileMap.get(path);
    if (!runtimeFile) throw new Error("Subtitle file not found.");
    if (runtimeFile.length > 8 * 1024 * 1024) {
      throw new Error("Subtitle files must be smaller than 8 MB.");
    }
    return (await runtimeFile.blob()).text();
  }

  async retry(): Promise<void> {
    if (!this.source || !this.handlers) return;
    if (this.reannounce()) {
      this.handlers.onPhase(
        this.torrent?.ready ? "ready" : "waiting",
        "Requesting fresh peer offers without clearing cached pieces...",
      );
      return;
    }
    await this.load(this.source, this.handlers);
  }

  async destroyCurrent(): Promise<void> {
    this.loadToken += 1;
    this.clearTimers();
    this.unbindTrackerDiagnostics();
    this.fileMap.clear();
    this.selectedFile = null;
    const torrent = this.torrent;
    this.torrent = null;

    if (torrent && this.client) {
      try {
        await Promise.resolve(
          this.client.remove(torrent.infoHash, { destroyStore: true }),
        );
      } catch {
        // Fatal torrent errors remove their own session before the UI can retry.
      }
    }
  }

  async destroy(): Promise<void> {
    await this.destroyCurrent();
    this.handlers = null;
    this.source = null;
    this.clientEpoch += 1;
    this.clientPromise = null;
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    await new Promise<void>((resolve) => {
      try {
        client.destroy(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  private clearMetadataTimer(): void {
    if (this.metadataTimer !== null) {
      window.clearTimeout(this.metadataTimer);
      this.metadataTimer = null;
    }
  }

  private clearMetricsTimer(): void {
    if (this.metricsTimer !== null) {
      window.clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
  }

  private clearReannounceTimer(): void {
    if (this.reannounceTimer !== null) {
      window.clearTimeout(this.reannounceTimer);
      this.reannounceTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearMetadataTimer();
    this.clearMetricsTimer();
    this.clearReannounceTimer();
    if (this.peerTimer !== null) {
      window.clearTimeout(this.peerTimer);
      this.peerTimer = null;
    }
  }
}

type TorrentRuntimeBackend = Pick<
  TorrentClientService,
  "getStream" | "readTextFile" | "retry" | "destroyCurrent" | "destroy"
>;

/**
 * Prefer the optional native companion for conventional-only magnet sources,
 * then use the browser WebTorrent engine if it is unavailable. Browser-native
 * sources stay on their established WSS/WebRTC path even when the helper is
 * running.
 */
class RoutedTorrentClientService {
  private readonly browser = new TorrentClientService();
  private readonly bridge = new LocalTorrentBridgeClient();
  private active: TorrentRuntimeBackend | null = null;
  private routeEpoch = 0;

  async load(
    source: TorrentSource,
    handlers: TorrentServiceHandlers,
  ): Promise<void> {
    const epoch = ++this.routeEpoch;
    await Promise.allSettled([
      this.browser.destroyCurrent(),
      this.bridge.destroyCurrent(),
    ]);
    if (epoch !== this.routeEpoch) return;

    const nativeOnly = shouldPreferNativeTransport(source.value);
    const bridged = nativeOnly
      ? await this.bridge.tryLoad(source, handlers)
      : false;
    if (epoch !== this.routeEpoch) {
      if (bridged) await this.bridge.destroyCurrent();
      return;
    }
    if (bridged) {
      this.active = this.bridge;
      return;
    }
    this.active = this.browser;
    await this.browser.load(source, handlers);
  }

  getStream(path: string): StreamSource {
    if (!this.active) throw new Error("No torrent session is active.");
    return this.active.getStream(path);
  }

  readTextFile(path: string): Promise<string> {
    if (!this.active) return Promise.reject(new Error("No torrent session is active."));
    return this.active.readTextFile(path);
  }

  retry(): Promise<void> {
    return this.active?.retry() || Promise.resolve();
  }

  async destroyCurrent(): Promise<void> {
    this.routeEpoch += 1;
    this.active = null;
    await Promise.allSettled([
      this.browser.destroyCurrent(),
      this.bridge.destroyCurrent(),
    ]);
  }

  async destroy(): Promise<void> {
    this.routeEpoch += 1;
    this.active = null;
    await Promise.allSettled([this.browser.destroy(), this.bridge.destroy()]);
  }
}

export const torrentClient = new RoutedTorrentClientService();

export function sourceFromMagnet(magnet: string): TorrentSource {
  return {
    value: magnet.trim(),
    label: "Magnet link",
  };
}

export function isPlayable(file: TorrentFileView): boolean {
  return file.category === "video" || file.category === "audio";
}

function normalizePlaybackMime(file: TorrentFileView): string {
  // Keep the real container type so the media element can make an accurate
  // support decision. Coercing MKV, MOV, AVI, AAC, or Opus to MP4/MP3 can leave
  // the player black while hiding the useful unsupported-format error.
  return file.mime;
}
