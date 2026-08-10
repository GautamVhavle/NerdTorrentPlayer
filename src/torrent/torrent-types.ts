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

export type TrackerStatus = "connecting" | "responding" | "degraded";

export interface TrackerDiagnostic {
  url: string;
  status: TrackerStatus;
  announces: number;
  lastAnnounceAt: number | null;
  seeders: number | null;
  leechers: number | null;
}

export interface TorrentSourceTransports {
  /** Secure WebTorrent trackers declared by the source. */
  wssTrackers: number;
  /** Native UDP trackers that a browser page cannot contact. */
  udpTrackers: number;
  /** HTTP(S) trackers that are not used by the secure browser client. */
  httpTrackers: number;
  /** Any other declared tracker transport, including insecure WS. */
  otherTrackers: number;
  /** Valid HTTP(S) payload sources declared with `ws` or `as`. */
  webSeeds: number;
  /** Valid HTTP(S) exact metadata sources declared with `xs`. */
  exactSources: number;
}

export interface TorrentMetrics {
  /** Runtime currently carrying the swarm session. */
  transportMode?: "browser" | "native-bridge";
  peers: number;
  downloadSpeed: number;
  uploadSpeed: number;
  progress: number;
  downloaded: number;
  uploaded: number;
  /** Bytes received from peers, including data that did not verify. */
  received?: number;
  ratio?: number;
  timeRemaining?: number | null;
  selectedFileProgress?: number | null;
  selectedFileDownloaded?: number | null;
  connectedWebRtcPeers?: number;
  connectedWebSeeds?: number;
  activeDownloadPeers?: number;
  unchokedPeers?: number;
  trackerCount?: number;
  responsiveTrackers?: number;
  trackerAnnounces?: number;
  reportedTrackerSeeders?: number;
  reportedTrackerLeechers?: number;
  /** Sum of tracker scrape populations; peers may overlap across trackers. */
  reportedSwarmPopulation?: number;
  /** Peer offers actually delivered by the browser tracker client. */
  trackerPeerCandidates?: number;
  trackerWarnings?: number;
  sessionWarnings?: number;
  recoverableWebRtcErrors?: number;
  publicTrackerFallbacks?: boolean;
  reannounceAttempts?: number;
  reannounceLimit?: number;
  trackerBindAttempts?: number;
  trackerBindLimit?: number;
  sourceTransports?: TorrentSourceTransports;
  peakDownloadSpeed?: number;
  timeToMetadataMs?: number | null;
  timeToFirstPeerMs?: number | null;
  timeToFirstByteMs?: number | null;
  stalledForMs?: number;
  pieceLength?: number | null;
  lastWarning?: string | null;
  trackers?: TrackerDiagnostic[];
}

export interface StreamSource {
  url: string;
  mime: string;
  file: TorrentFileView;
  /** Delivery shape used to configure the media player and explain failures. */
  playbackKind?: "direct" | "hls" | "remux" | "transcode";
  /** HLS from the local bridge is a sliding live window, not a seekable file. */
  streamType?: "on-demand" | "live" | "live:dvr";
}

export interface RuntimeTorrentFile {
  name: string;
  path: string;
  length: number;
  type?: string;
  downloaded?: number;
  progress?: number;
  streamURL: string;
  blob(options?: { start?: number; end?: number }): Promise<Blob>;
  select?(priority?: number): void;
  deselect?(): void;
}

export interface RuntimeWire {
  type?: string;
  peerChoking?: boolean;
  downloaded?: number;
  uploaded?: number;
  downloadSpeed?(): number;
  uploadSpeed?(): number;
  on?(event: string, listener: (...args: unknown[]) => void): this;
  once?(event: string, listener: (...args: unknown[]) => void): this;
}

export interface RuntimeTrackerUpdate {
  announce?: string;
  complete?: number;
  incomplete?: number;
}

export interface RuntimeTrackerClient {
  destroyed?: boolean;
  update(options?: {
    uploaded?: number;
    downloaded?: number;
    left?: number;
    numwant?: number;
  }): void;
  on(event: string, listener: (...args: unknown[]) => void): this;
  off?(event: string, listener: (...args: unknown[]) => void): this;
  removeListener?(event: string, listener: (...args: unknown[]) => void): this;
}

export interface RuntimeParsedTorrent {
  infoHash: string;
  private?: boolean;
  announce?: string[];
  [key: string]: unknown;
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
  announce?: string[];
  pieceLength?: number;
  received?: number;
  ratio?: number;
  timeRemaining?: number;
  ready?: boolean;
  done?: boolean;
  destroyed?: boolean;
  wires?: RuntimeWire[];
  discovery?: { tracker?: RuntimeTrackerClient | null } | null;
  on(event: string, listener: (...args: unknown[]) => void): this;
  off?(event: string, listener: (...args: unknown[]) => void): this;
}

export interface RuntimeWebTorrentClient {
  add(
    torrentId: string | Uint8Array | RuntimeParsedTorrent,
    options: {
      announce: string[];
      deselect?: boolean;
      strategy?: "sequential" | "rarest";
      destroyStoreOnDestroy?: boolean;
      noPeersIntervalTime?: number;
      maxWebConns?: number;
      storeCacheSlots?: number;
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
