export type TorrentPhase =
  | "idle"
  | "initializing"
  | "metadata"
  | "waiting"
  | "ready"
  | "streaming"
  | "failed";

export type FileCategory =
  | "video"
  | "audio"
  | "subtitle"
  | "image"
  | "other";

export type Compatibility = "likely" | "maybe" | "unlikely";

export interface TorrentFileView {
  id: string;
  name: string;
  path: string;
  length: number;
  extension: string;
  category: FileCategory;
  mime: string;
  compatibility: Compatibility;
  rank: number;
  progress: number;
}

export interface TorrentMeta {
  infoHash: string;
  name: string;
  length: number;
}

export interface TorrentMetrics {
  peers: number;
  downloadSpeed: number;
  uploadSpeed: number;
  progress: number;
  downloaded: number;
  uploaded: number;
}

export interface StreamSource {
  url: string;
  mime: string;
  file: TorrentFileView;
}

export interface RuntimeTorrentFile {
  name: string;
  path: string;
  length: number;
  type?: string;
  progress?: number;
  streamURL: string;
  blob(options?: { start?: number; end?: number }): Promise<Blob>;
  select?(): void;
  deselect?(): void;
}

export interface RuntimeTorrent {
  infoHash: string;
  name: string;
  length: number;
  downloaded: number;
  uploaded: number;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  numPeers: number;
  files: RuntimeTorrentFile[];
  on(event: string, listener: (...args: unknown[]) => void): this;
  off?(event: string, listener: (...args: unknown[]) => void): this;
}

export interface RuntimeWebTorrentClient {
  add(
    torrentId: string | Uint8Array,
    options: {
      announce: string[];
      deselect?: boolean;
      strategy?: "sequential" | "rarest";
      destroyStoreOnDestroy?: boolean;
      noPeersIntervalTime?: number;
    },
    callback: (torrent: RuntimeTorrent) => void,
  ): RuntimeTorrent;
  createServer(options: {
    controller: ServiceWorkerRegistration;
    origin?: false | string;
  }): unknown;
  remove(
    torrentId: string,
    options?: { destroyStore?: boolean },
  ): Promise<void> | void;
  destroy(callback?: (error?: Error) => void): void;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export interface TorrentServiceHandlers {
  onPhase(phase: TorrentPhase, message: string): void;
  onReady(meta: TorrentMeta, files: TorrentFileView[]): void;
  onMetrics(metrics: TorrentMetrics): void;
  onNoPeers(message: string): void;
  onError(message: string): void;
}

export interface TorrentSource {
  value: string | Uint8Array;
  label: string;
}
