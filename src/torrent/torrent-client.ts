import { mapAndSortFiles } from "./torrent-files";
import type {
  RuntimeTorrent,
  RuntimeTorrentFile,
  RuntimeWebTorrentClient,
  StreamSource,
  TorrentFileView,
  TorrentMeta,
  TorrentMetrics,
  TorrentServiceHandlers,
  TorrentSource,
} from "./torrent-types";

const DEFAULT_ANNOUNCE = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
];

const MAGNET_PATTERN = /^magnet:\?(.+&)?xt=urn:btih:[a-z0-9]{32,40}(&|$)/i;

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The torrent could not be opened in this browser.";
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
  private torrent: RuntimeTorrent | null = null;
  private handlers: TorrentServiceHandlers | null = null;
  private source: TorrentSource | null = null;
  private fileMap = new Map<string, RuntimeTorrentFile>();
  private selectedFile: RuntimeTorrentFile | null = null;
  private metricsTimer: number | null = null;
  private metadataTimer: number | null = null;
  private peerTimer: number | null = null;
  private loadToken = 0;

  private async ensureClient(): Promise<RuntimeWebTorrentClient> {
    if (this.client) return this.client;
    if (this.clientPromise) return this.clientPromise;

    this.clientPromise = (async () => {
      if (typeof window === "undefined") {
        throw new Error("WebTorrent can only run in a browser.");
      }

      if (!("serviceWorker" in navigator)) {
        throw new Error(
          "This browser cannot create the local streaming bridge required for playback.",
        );
      }

      const [{ default: WebTorrent }, registration] = await Promise.all([
        import("webtorrent/dist/webtorrent.min.js"),
        navigator.serviceWorker.register("/sw.min.js", { scope: "/" }),
      ]);

      await navigator.serviceWorker.ready;
      const readyRegistration = await navigator.serviceWorker.ready;
      const client = new WebTorrent({
        dht: false,
        lsd: false,
        natUpnp: false,
        natPmp: false,
      });

      client.createServer({
        controller: readyRegistration || registration,
        origin: false,
      });

      client.on("error", (error: unknown) => {
        this.handlers?.onError(messageFromError(error));
      });

      this.client = client;
      return client;
    })().catch((error) => {
      this.clientPromise = null;
      throw error;
    });

    return this.clientPromise;
  }

  async load(
    source: TorrentSource,
    handlers: TorrentServiceHandlers,
  ): Promise<void> {
    await this.destroyCurrent();
    const token = ++this.loadToken;
    this.handlers = handlers;
    this.source = source;
    handlers.onPhase("initializing", "Starting the browser P2P engine...");

    try {
      const client = await this.ensureClient();
      if (token !== this.loadToken) return;

      handlers.onPhase("metadata", "Reading torrent metadata...");
      const torrent = client.add(
        source.value,
        {
          announce: DEFAULT_ANNOUNCE,
          deselect: true,
          strategy: "sequential",
          destroyStoreOnDestroy: true,
          noPeersIntervalTime: 10,
        },
        (readyTorrent) => {
          if (token !== this.loadToken) return;
          this.handleReady(readyTorrent);
        },
      );

      this.torrent = torrent;
      this.attachTorrentEvents(torrent, token);
      this.beginMetrics(torrent, token);
      this.metadataTimer = window.setTimeout(() => {
        if (token !== this.loadToken) return;
        handlers.onPhase(
          "waiting",
          "Still searching for WebTorrent-compatible peers...",
        );
        handlers.onNoPeers(
          "Metadata is taking longer than usual. This browser can only reach peers that support WebRTC.",
        );
      }, 35_000);
    } catch (error) {
      if (token !== this.loadToken) return;
      handlers.onPhase("failed", "Connection failed.");
      handlers.onError(messageFromError(error));
    }
  }

  private attachTorrentEvents(torrent: RuntimeTorrent, token: number): void {
    torrent.on("error", (error) => {
      if (token !== this.loadToken) return;
      this.handlers?.onError(messageFromError(error));
    });

    torrent.on("noPeers", () => {
      if (token !== this.loadToken) return;
      this.handlers?.onNoPeers(
        "No WebRTC peers are responding yet. Keep this tab open or try a torrent seeded by a WebTorrent-compatible client.",
      );
    });
  }

  private handleReady(torrent: RuntimeTorrent): void {
    this.clearMetadataTimer();
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
          "The file list is ready, but no WebRTC peers are sending data yet.",
        );
      }
    }, 12_000);
  }

  private beginMetrics(torrent: RuntimeTorrent, token: number): void {
    this.clearMetricsTimer();
    const emit = () => {
      if (token !== this.loadToken || this.torrent !== torrent) return;
      const metrics: TorrentMetrics = {
        peers: torrent.numPeers || 0,
        downloadSpeed: torrent.downloadSpeed || 0,
        uploadSpeed: torrent.uploadSpeed || 0,
        progress: torrent.progress || 0,
        downloaded: torrent.downloaded || 0,
        uploaded: torrent.uploaded || 0,
      };
      this.handlers?.onMetrics(metrics);
    };

    emit();
    this.metricsTimer = window.setInterval(emit, 750);
  }

  getStream(path: string): StreamSource {
    const runtimeFile = this.fileMap.get(path);
    if (!runtimeFile) throw new Error("That file is no longer available.");
    const files = mapAndSortFiles([runtimeFile]);
    const file = files[0];
    if (this.selectedFile && this.selectedFile !== runtimeFile) {
      this.selectedFile.deselect?.();
    }
    runtimeFile.select?.();
    this.selectedFile = runtimeFile;
    this.handlers?.onPhase("streaming", "Stream prepared.");
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
    await this.load(this.source, this.handlers);
  }

  async destroyCurrent(): Promise<void> {
    this.loadToken += 1;
    this.clearTimers();
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
        // The torrent may already have been removed by an internal error.
      }
    }
  }

  async destroy(): Promise<void> {
    await this.destroyCurrent();
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    this.clientPromise = null;
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

  private clearTimers(): void {
    this.clearMetadataTimer();
    this.clearMetricsTimer();
    if (this.peerTimer !== null) {
      window.clearTimeout(this.peerTimer);
      this.peerTimer = null;
    }
  }
}

export const torrentClient = new TorrentClientService();

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
  if (file.category === "video") {
    if (file.extension === "webm") return "video/webm";
    if (file.extension === "ogv") return "video/ogg";
    if (file.extension === "avi") return "video/avi";
    return "video/mp4";
  }
  if (file.category === "audio") {
    if (file.extension === "m4a" || file.extension === "aac") {
      return "audio/mp4";
    }
    if (file.extension === "ogg" || file.extension === "oga") {
      return "audio/ogg";
    }
    if (file.extension === "wav") return "audio/wav";
    if (file.extension === "flac") return "audio/flac";
    return "audio/mpeg";
  }
  return file.mime;
}
