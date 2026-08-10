"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AudioLines,
  BookOpen,
  Braces,
  Captions,
  Check,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Clock3,
  Cpu,
  Download,
  ExternalLink,
  File,
  FileArchive,
  FileText,
  Film,
  HardDriveDownload,
  Image as ImageIcon,
  Keyboard,
  LockKeyhole,
  MonitorPlay,
  Network,
  Pin,
  PinOff,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Subtitles,
  Terminal,
  Timer,
  Trash2,
  Upload,
  Users,
  Waypoints,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  clearResumeRecords,
  listResumeRecords,
  type ResumeRecord,
} from "../lib/history";
import {
  clearLibrary,
  deleteLibraryRecord,
  getLibrarySource,
  getLibraryStorageStatus,
  listLibraryRecords,
  saveLibraryRecord,
  touchLibraryRecord,
  updateLibraryRecord,
  type LibraryRecord,
  type LibraryStorageStatus,
} from "../lib/library";
import {
  inferSubtitleFormat,
  subtitleFromUpload,
  type SubtitleTrackModel,
} from "../subtitles/subtitle-parser";
import {
  formatBytes,
  formatSpeed,
  getLanguageFromFilename,
} from "../torrent/torrent-files";
import {
  isPlayable,
  SINTEL_DEMO_SOURCE,
  sourceFromMagnet,
  sourceFromTorrentFile,
  torrentClient,
  validateMagnet,
} from "../torrent/torrent-client";
import type {
  FileCategory,
  TorrentFileView,
  TorrentSource,
} from "../torrent/torrent-types";
import {
  useTorrentStore,
  type InspectorPanel,
  type PlayerPreferences,
} from "../stores/torrent-store";
import { Modal, MobileSheet } from "./Modal";

const RetroPlayer = lazy(() =>
  import("./RetroPlayer").then((module) => ({ default: module.RetroPlayer })),
);

const PREFS_KEY = "nerdtorrentplayer:prefs:v1";
const LEGACY_PREFS_KEY = "torrent-exe:prefs:v1";

function subtitleOffsetKey(infoHash: string, filePath: string) {
  return `nerdtorrentplayer:subtitle-offset:${infoHash}:${filePath}`;
}

function legacySubtitleOffsetKey(infoHash: string, filePath: string) {
  return `torrent-exe:subtitle-offset:${infoHash}:${filePath}`;
}

function formatClockTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function formatRelativeSession(timestamp: number) {
  const difference = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(difference / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatLatency(milliseconds?: number | null) {
  if (milliseconds === null || milliseconds === undefined) return "—";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

function formatDurationMs(milliseconds?: number | null) {
  if (
    milliseconds === null ||
    milliseconds === undefined ||
    !Number.isFinite(milliseconds)
  ) {
    return "—";
  }
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}h ${String(minutes).padStart(2, "0")}m`
    : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function trackerLabel(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^wss?:\/\//, "").slice(0, 32);
  }
}

function FileKindIcon({
  category,
  size = 19,
}: {
  category: FileCategory;
  size?: number;
}) {
  if (category === "video") {
    return <Film aria-hidden="true" size={size} />;
  }
  if (category === "audio") {
    return <AudioLines aria-hidden="true" size={size} />;
  }
  if (category === "subtitle") {
    return <Subtitles aria-hidden="true" size={size} />;
  }
  if (category === "image") {
    return <ImageIcon aria-hidden="true" size={size} />;
  }
  return <FileText aria-hidden="true" size={size} />;
}

function MetricChip({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <span className="metric-chip">
      {icon}
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </span>
  );
}

function CompatibilityBadge({
  file,
}: {
  file: TorrentFileView;
}) {
  if (file.compatibility === "likely") {
    return (
      <span className="compat-badge likely">
        <Check aria-hidden="true" size={12} />
        Browser ready
      </span>
    );
  }

  if (file.compatibility === "maybe") {
    return (
      <span className="compat-badge maybe">
        <AlertTriangle aria-hidden="true" size={12} />
        Codec dependent
      </span>
    );
  }

  return <span className="compat-badge muted">Not playable</span>;
}

function PeerNotice({
  message,
  nativeTransport,
  onRetry,
  onDismiss,
}: {
  message: string;
  nativeTransport?: boolean;
  onRetry(): void;
  onDismiss(): void;
}) {
  return (
    <motion.div
      className="peer-notice"
      role="status"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
    >
      <span className="peer-notice-icon" aria-hidden="true">
        <WifiOff size={20} />
      </span>
      <div>
        <span className="peer-notice-kicker">HANDSHAKE PENDING</span>
        <strong>
          {nativeTransport
            ? "No conventional payload peer has answered yet"
            : "No browser-compatible peer has answered yet"}
        </strong>
        <p>{message}</p>
        <small>
          {nativeTransport
            ? "The localhost bridge keeps native tracker and peer discovery active."
            : "This is usually a swarm compatibility issue, not a failure in your browser."}
        </small>
      </div>
      <div className="inline-actions">
        <button className="mini-button active" type="button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" size={14} />
          {nativeTransport ? "Restart native session" : "Refresh trackers"}
        </button>
        <button className="mini-button" type="button" onClick={onDismiss}>
          Keep listening
        </button>
      </div>
    </motion.div>
  );
}

interface HomeStageProps {
  phase: ReturnType<typeof useTorrentStore.getState>["phase"];
  phaseMessage: string;
  peerNotice: string | null;
  error: string | null;
  history: ResumeRecord[];
  onStart(source: TorrentSource, saveToLibrary: boolean): void;
  onDemo(saveToLibrary: boolean): void;
  onCancel(): void;
  onRetry(): void;
  onDismissPeerNotice(): void;
  onWhy(): void;
  onOpenLibrary(): void;
  onClearHistory(): void;
}

function HomeStage({
  phase,
  phaseMessage,
  peerNotice,
  error,
  history,
  onStart,
  onDemo,
  onCancel,
  onRetry,
  onDismissPeerNotice,
  onWhy,
  onOpenLibrary,
  onClearHistory,
}: HomeStageProps) {
  const [magnet, setMagnet] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [bootSeconds, setBootSeconds] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();
  const metrics = useTorrentStore((state) => state.metrics);
  const loading =
    phase === "initializing" || phase === "metadata" || phase === "waiting";

  useEffect(() => {
    if (!loading) return;
    const startedAt = Date.now();
    const resetTimer = window.setTimeout(() => setBootSeconds(0), 0);
    const timer = window.setInterval(
      () => setBootSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1_000,
    );
    return () => {
      window.clearTimeout(resetTimer);
      window.clearInterval(timer);
    };
  }, [loading]);

  const submitMagnet = (event: FormEvent) => {
    event.preventDefault();
    const validationError = validateMagnet(magnet);
    if (validationError) {
      setInputError(validationError);
      return;
    }
    setInputError(null);
    onStart(sourceFromMagnet(magnet), saveToLibrary);
  };

  const chooseTorrentFile = async (file?: File) => {
    if (!file) return;
    try {
      setInputError(null);
      onStart(await sourceFromTorrentFile(file), saveToLibrary);
    } catch (uploadError) {
      setInputError(
        uploadError instanceof Error
          ? uploadError.message
          : "That torrent file could not be read.",
      );
    }
  };

  const pasteMagnet = async () => {
    try {
      const value = await navigator.clipboard.readText();
      setMagnet(value);
      setInputError(null);
    } catch {
      setInputError("Clipboard access was blocked. Paste into the field instead.");
    }
  };

  const activeBootStep =
    phase === "initializing" ? 1 : phase === "metadata" ? 2 : 3;
  const sourceTransports = metrics.sourceTransports;
  const sourceWssTrackers = sourceTransports?.wssTrackers ?? 0;
  const sourceNonWssTrackers = sourceTransports
    ? sourceTransports.udpTrackers +
      sourceTransports.httpTrackers +
      sourceTransports.otherTrackers
    : 0;
  const sourceWebSeeds = sourceTransports?.webSeeds ?? 0;
  const sourceExactSources = sourceTransports?.exactSources ?? 0;
  const trackerRoutes = metrics.trackerCount ?? 0;
  const responsiveTrackers = metrics.responsiveTrackers ?? 0;
  const peerCandidates = metrics.trackerPeerCandidates ?? 0;
  const reportedPopulation = metrics.reportedSwarmPopulation ?? 0;
  const reannounceAttempts = metrics.reannounceAttempts ?? 0;
  const reannounceLimit = metrics.reannounceLimit ?? 3;
  const nativeTransport = metrics.transportMode === "native-bridge";
  const discoveryStatus =
    phase === "initializing"
      ? nativeTransport
        ? "Preparing localhost native transport"
        : "Preparing browser transport"
      : phase === "metadata"
        ? nativeTransport
          ? `Querying ${sourceNonWssTrackers} conventional tracker route${sourceNonWssTrackers === 1 ? "" : "s"}`
          : trackerRoutes
          ? `Querying ${trackerRoutes} secure tracker route${trackerRoutes === 1 ? "" : "s"}`
          : "No secure tracker route is available yet"
        : nativeTransport
          ? metrics.peers
            ? `${metrics.peers} native peer${metrics.peers === 1 ? "" : "s"} connected`
            : "Native tracker and DHT discovery active"
          : responsiveTrackers
          ? `${responsiveTrackers}/${trackerRoutes} trackers responded · ${peerCandidates} peer offers delivered`
          : reannounceAttempts >= reannounceLimit
            ? `No tracker response after ${reannounceAttempts} refresh requests`
            : `Waiting · ${responsiveTrackers}/${trackerRoutes} trackers responded`;
  const traceStatus =
    phase === "initializing"
      ? "starting"
      : metrics.peers
        ? "connected"
        : phase === "waiting"
          ? "waiting"
          : "querying";
  const bootLog =
    phase === "initializing"
      ? nativeTransport
        ? [
            "bridge.capability ...... verified",
            "native.session ......... authorizing",
            "torrent.engine ......... initializing",
          ]
        : [
            "source.transport ........ inspecting",
            "service-worker.bridge ... starting",
            "peer-engine ............. initializing",
          ]
      : phase === "metadata"
        ? nativeTransport
          ? [
              `source.trackers ......... ${sourceNonWssTrackers} native / ${sourceWssTrackers} WSS`,
              "native.discovery ........ tracker + peer search",
              `swarm.peers ............. ${metrics.peers} connected`,
            ]
          : [
              `source.trackers ......... ${sourceWssTrackers} WSS / ${sourceNonWssTrackers} non-WSS`,
              `browser.routes .......... ${trackerRoutes} secure tracker${trackerRoutes === 1 ? "" : "s"}`,
              `metadata.bootstrap ...... ${sourceWebSeeds} web seed${sourceWebSeeds === 1 ? "" : "s"} / ${sourceExactSources} exact source${sourceExactSources === 1 ? "" : "s"}`,
            ]
        : nativeTransport
          ? [
              `native.peers ............ ${metrics.peers} connected`,
              `torrent.ingress ......... ${formatSpeed(metrics.downloadSpeed)}`,
              `verified.bytes .......... ${formatBytes(metrics.downloaded)}`,
            ]
          : [
            `tracker.responses ....... ${responsiveTrackers}/${trackerRoutes}`,
            `tracker.peer-offers ..... ${peerCandidates} delivered`,
            `swarm.population ........ ${reportedPopulation} reported`,
            `refresh.requests ........ ${reannounceAttempts}/${reannounceLimit}`,
          ];

  if (loading) {
    return (
      <section className="home-stage loading-stage" aria-labelledby="loading-title">
        <motion.div
          className="loading-console boot-console"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.985, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.32, ease: "easeOut" }}
        >
          <div className="console-topline">
            <span className="eyebrow">
              <Terminal aria-hidden="true" size={12} />
              SWARM SESSION / BOOT
            </span>
            <span className="boot-timer">
              <Timer aria-hidden="true" size={12} />
              T+{formatClockTime(bootSeconds)}
            </span>
          </div>

          <div className="boot-grid">
            <div className="loading-core" aria-live="polite">
              <div className="swarm-visual" aria-hidden="true">
                <span className="swarm-ring ring-one" />
                <span className="swarm-ring ring-two" />
                <span className="swarm-orbit orbit-one">
                  <i />
                </span>
                <span className="swarm-orbit orbit-two">
                  <i />
                </span>
                <motion.span
                  className="swarm-core"
                  animate={reduceMotion ? undefined : { scale: [1, 1.08, 1] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                >
                  <Waypoints size={25} />
                </motion.span>
              </div>
              <span className="eyebrow">NERDTORRENT CORE</span>
              <h1 id="loading-title">{phaseMessage}</h1>
              <p>
                {nativeTransport
                  ? `The private localhost bridge is using the source's UDP/TCP routes and native peers. ${sourceNonWssTrackers} conventional tracker route${sourceNonWssTrackers === 1 ? " is" : "s are"} available to this session.`
                  : "This page can use WSS trackers, WebRTC peers, web seeds, and exact metadata sources. "}
                {!nativeTransport && sourceNonWssTrackers
                  ? `${sourceNonWssTrackers} declared non-WSS tracker route${sourceNonWssTrackers === 1 ? "" : "s"} require a native torrent client and are not opened here.`
                  : !nativeTransport
                    ? "Live route counts appear below as each browser transport becomes available."
                    : null}
              </p>

              <div className="boot-progress" role="status">
                <span>
                  <motion.i
                    initial={false}
                    animate={
                      reduceMotion
                        ? { scaleX: 0.65, x: "18%" }
                        : {
                            scaleX: [0.16, 0.7, 0.16],
                            x: ["-30%", "45%", "120%"],
                          }
                    }
                    transition={{
                      duration: 1.6,
                      repeat: reduceMotion ? 0 : Infinity,
                      ease: "easeInOut",
                    }}
                  />
                </span>
                <output>{discoveryStatus}</output>
              </div>
            </div>

            <div className="boot-diagnostics">
              <div className="diagnostic-heading">
                <span>
                  <Braces size={13} /> live.trace
                </span>
                <span className="trace-status">{traceStatus}</span>
              </div>
              <div className="terminal-log">
                {bootLog.map((line, index) => (
                  <motion.code
                    key={line}
                    initial={reduceMotion ? false : { opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.08 }}
                  >
                    <span>&gt;</span> {line}
                  </motion.code>
                ))}
                <code className="terminal-cursor">
                  <span>&gt;</span> <i />
                </code>
              </div>
              <div className="protocol-badges">
                {nativeTransport ? (
                  <>
                    <span>NATIVE TRACKERS</span>
                    <span>TCP PEERS</span>
                    <span>LOCAL MEDIA</span>
                  </>
                ) : (
                  <>
                    <span>{trackerRoutes} WSS ROUTES</span>
                    <span>{sourceWebSeeds} WEB SEEDS</span>
                    <span>{sourceExactSources} EXACT SOURCES</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <ol className="boot-steps" aria-label="Connection progress">
            {[
              ["Validate source", "Magnet / torrent parsed"],
              [
                "Launch engine",
                nativeTransport ? "Native bridge online" : "Streaming bridge online",
              ],
              [
                nativeTransport ? "Query native routes" : "Query browser routes",
                nativeTransport
                  ? `${sourceNonWssTrackers} conventional tracker routes`
                  : `${trackerRoutes} secure tracker routes`,
              ],
              [
                "Resolve metadata",
                nativeTransport
                  ? `${metrics.peers} native peers connected`
                  : `${peerCandidates} tracker peer offers delivered`,
              ],
            ].map(([label, detail], index) => {
              const step = index;
              const phaseStep = activeBootStep;
              const complete = step < phaseStep;
              const active = step === phaseStep;
              return (
                <li
                  className={complete ? "complete" : active ? "active" : ""}
                  key={label}
                >
                  <span className="boot-step-index" aria-hidden="true">
                    {complete ? <Check size={13} /> : String(index + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <strong>{label}</strong>
                    <small>{detail}</small>
                  </span>
                </li>
              );
            })}
          </ol>

          {peerNotice ? (
            <PeerNotice
              message={peerNotice}
              nativeTransport={nativeTransport}
              onRetry={onRetry}
              onDismiss={onDismissPeerNotice}
            />
          ) : null}

          <button className="text-button danger-text" type="button" onClick={onCancel}>
            <X aria-hidden="true" size={15} />
            Abort swarm session
          </button>
        </motion.div>
      </section>
    );
  }

  return (
    <section className="home-stage" aria-labelledby="home-title">
      <motion.div
        className="hero-copy"
        initial={reduceMotion ? false : "hidden"}
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
        }}
      >
        <motion.span
          className="chapter-label hero-terminal-label"
          variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
        >
          <Terminal aria-hidden="true" size={13} />
          NERDTORRENTPLAYER / BROWSER P2P MEDIA LAB
        </motion.span>
        <motion.h1
          id="home-title"
          aria-label="STREAM THE SWARM."
          variants={{ hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0 } }}
        >
          STREAM THE
          <span>SWARM.</span>
        </motion.h1>
        <motion.p
          variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
        >
          Fast-start, local-first torrent streaming with browser WebRTC and an
          optional private bridge for conventional swarms.
        </motion.p>
        <motion.div
          className="hero-proof-row"
          variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
          aria-label="Platform capabilities"
        >
          <span>
            <Zap aria-hidden="true" size={13} />
            Seek-first pieces
          </span>
          <span>
            <Activity aria-hidden="true" size={13} />
            Live swarm telemetry
          </span>
          <span>
            <ShieldCheck aria-hidden="true" size={13} />
            Zero media uploads
          </span>
        </motion.div>
      </motion.div>

      <motion.div
        className="source-console"
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, delay: reduceMotion ? 0 : 0.18 }}
      >
        <div className="console-topline">
          <span className="eyebrow">
            <Cpu aria-hidden="true" size={12} />
            NEW SWARM SESSION
          </span>
          <span className="secure-indicator">
            <LockKeyhole aria-hidden="true" size={13} />
            LOCAL PROCESSING
          </span>
        </div>

        {error ? (
          <div className="inline-error" role="alert">
            <AlertTriangle aria-hidden="true" size={18} />
            <div>
              <strong>Could not start this torrent</strong>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        <form className="magnet-form" onSubmit={submitMagnet} noValidate>
          <div className="input-label-row">
            <label htmlFor="magnet-input">Magnet URI</label>
            <span>PRIMARY INPUT</span>
          </div>
          <div className={"magnet-field " + (inputError ? "has-error" : "")}>
            <span className="prompt-mark" aria-hidden="true">
              &gt;_
            </span>
            <input
              id="magnet-input"
              type="text"
              value={magnet}
              onChange={(event) => {
                setMagnet(event.target.value);
                if (inputError) setInputError(null);
              }}
              placeholder="magnet:?xt=urn:btih:..."
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={inputError ? "magnet-error" : "magnet-help"}
              aria-invalid={Boolean(inputError)}
            />
            <button
              className="paste-button"
              type="button"
              onClick={() => void pasteMagnet()}
              aria-label="Paste magnet link from clipboard"
            >
              <Clipboard aria-hidden="true" size={16} />
              Paste
            </button>
          </div>
          {inputError ? (
            <p className="field-error" id="magnet-error">
              <AlertTriangle aria-hidden="true" size={14} />
              {inputError}
            </p>
          ) : (
            <p className="field-help" id="magnet-help">
              Parsed locally. Browser-compatible swarms work here; UDP/TCP-only magnets
              require localhost mode.
            </p>
          )}
          <label
            className="save-source-toggle"
            htmlFor="save-source-checkbox"
            aria-label="Save this source in my private on-device library"
          >
            <input
              id="save-source-checkbox"
              type="checkbox"
              checked={saveToLibrary}
              onChange={(event) => setSaveToLibrary(event.target.checked)}
            />
            <span className="toggle-track" aria-hidden="true">
              <i />
            </span>
            <span className="toggle-copy">
              <strong>Save this source in my private on-device library</strong>
              <small>
                Stores the magnet or .torrent bytes in IndexedDB so you can
                reconnect later. Never synced.
              </small>
            </span>
          </label>
          <button className="arcade-button primary-action" type="submit">
            <Waypoints aria-hidden="true" size={18} />
            Initialize swarm
            <ChevronRight aria-hidden="true" size={17} />
          </button>
          <button
            className="demo-button"
            type="button"
            onClick={() => onDemo(saveToLibrary)}
          >
            <Film aria-hidden="true" size={15} />
            Try Sintel demo
            <span>LEGAL SAMPLE</span>
          </button>
        </form>

        <div className="console-divider">
          <span>OR LOAD A FILE</span>
        </div>

        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept=".torrent,application/x-bittorrent"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            void chooseTorrentFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <button
          className={"torrent-dropzone " + (dropActive ? "is-dragging" : "")}
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDropActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDropActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDropActive(false);
            void chooseTorrentFile(event.dataTransfer.files?.[0]);
          }}
        >
          <span className="drop-icon">
            <Upload aria-hidden="true" size={24} />
          </span>
          <span>
            <strong>Drop a .torrent manifest</strong>
            <small>or browse your device · parsed locally</small>
          </span>
          <span className="file-tag">.TORRENT</span>
        </button>

        <button className="browser-limit" type="button" onClick={onWhy}>
          <Radio aria-hidden="true" size={15} />
          Browser WebRTC plus an optional localhost native bridge.
          <span>Inspect the protocol</span>
        </button>
      </motion.div>

      {history.length ? (
        <section className="recent-panel" aria-labelledby="recent-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">
                <Clock3 aria-hidden="true" size={12} />
                PLAYBACK ACTIVITY
              </span>
              <h2 id="recent-title">Recent resume points</h2>
            </div>
            <div className="section-actions">
              <button className="text-button" type="button" onClick={onClearHistory}>
                <Trash2 aria-hidden="true" size={14} />
                Clear
              </button>
              <button className="mini-button active" type="button" onClick={onOpenLibrary}>
                View library
                <ChevronRight aria-hidden="true" size={13} />
              </button>
            </div>
          </div>
          <div className="recent-list">
            {history.slice(0, 3).map((record, index) => {
              const progress = record.duration
                ? Math.min(100, Math.max(0, (record.position / record.duration) * 100))
                : 0;
              return (
              <motion.div
                className="recent-row"
                key={record.id}
                initial={reduceMotion ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.06 }}
              >
                <span className="recent-icon">
                  <Film aria-hidden="true" size={18} />
                </span>
                <span className="recent-copy">
                  <strong>{record.fileName}</strong>
                  <small>{record.torrentName}</small>
                  <span className="recent-progress" aria-hidden="true">
                    <i style={{ width: `${progress}%` }} />
                  </span>
                </span>
                <span className="recent-time">
                  <Clock3 aria-hidden="true" size={13} />
                  {formatClockTime(record.position)} / {formatClockTime(record.duration)}
                </span>
                <span className="recent-note">{formatRelativeSession(record.lastOpenedAt)}</span>
              </motion.div>
              );
            })}
          </div>
          <p className="library-privacy-note">
            <LockKeyhole aria-hidden="true" size={12} />
            Resume points stay on this device. Save the source separately in
            Library to reconnect without pasting it again.
          </p>
        </section>
      ) : (
        <div className="feature-grid" aria-label="Product features">
          <article>
            <Zap aria-hidden="true" size={21} />
            <strong>Seek-first fetching</strong>
            <p>Prioritizes pieces around playback instead of waiting for 100%.</p>
          </article>
          <article>
            <Activity aria-hidden="true" size={21} />
            <strong>Nerd telemetry</strong>
            <p>Inspect peers, throughput, received bytes, and swarm progress.</p>
          </article>
          <article>
            <ShieldCheck aria-hidden="true" size={21} />
            <strong>Zero-server media</strong>
            <p>Your app server never receives, stores, or transcodes the file.</p>
          </article>
          <article>
            <Subtitles aria-hidden="true" size={21} />
            <strong>Precision captions</strong>
            <p>Load SRT, VTT, ASS, or SSA and nudge timing by tenths.</p>
          </article>
        </div>
      )}
    </section>
  );
}

function LibraryPanel({
  onOpen,
}: {
  onOpen(record: LibraryRecord): void;
}) {
  const library = useTorrentStore((state) => state.library);
  const loading = useTorrentStore((state) => state.libraryLoading);
  const error = useTorrentStore((state) => state.libraryError);
  const query = useTorrentStore((state) => state.libraryQuery);
  const filter = useTorrentStore((state) => state.libraryFilter);
  const sort = useTorrentStore((state) => state.librarySort);
  const setQuery = useTorrentStore((state) => state.setLibraryQuery);
  const setFilter = useTorrentStore((state) => state.setLibraryFilter);
  const setSort = useTorrentStore((state) => state.setLibrarySort);
  const setLibrary = useTorrentStore((state) => state.setLibrary);
  const upsertRecord = useTorrentStore((state) => state.upsertLibraryRecord);
  const removeRecord = useTorrentStore((state) => state.removeLibraryRecord);
  const setLibraryError = useTorrentStore((state) => state.setLibraryError);
  const [storage, setStorage] = useState<LibraryStorageStatus | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let active = true;
    void listLibraryRecords()
      .then((records) => {
        if (active) setLibrary(records);
      })
      .catch((loadError) => {
        if (!active) return;
        setLibraryError(
          loadError instanceof Error
            ? loadError.message
            : "The local library could not be refreshed.",
        );
      });
    return () => {
      active = false;
    };
  }, [setLibrary, setLibraryError]);

  useEffect(() => {
    void getLibraryStorageStatus().then(setStorage);
  }, [library.length]);

  const visibleRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const records = library.filter((record) => {
      if (filter === "pinned" && !record.pinned) return false;
      if (!normalizedQuery) return true;
      return (
        record.title.toLocaleLowerCase().includes(normalizedQuery) ||
        record.infoHash.toLocaleLowerCase().includes(normalizedQuery) ||
        record.selectedFilePath?.toLocaleLowerCase().includes(normalizedQuery)
      );
    });

    const sortedRecords = [...records].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "progress") return b.progress - a.progress;
      return (
        Number(b.pinned) - Number(a.pinned) || b.lastOpenedAt - a.lastOpenedAt
      );
    });
    return filter === "recent"
      ? sortedRecords.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 10)
      : sortedRecords;
  }, [filter, library, query, sort]);

  const togglePinned = (record: LibraryRecord) => {
    setWorkingId(record.id);
    void updateLibraryRecord(record.id, { pinned: !record.pinned })
      .then((updated) => {
        if (updated) upsertRecord(updated);
      })
      .catch((pinError) =>
        setLibraryError(
          pinError instanceof Error ? pinError.message : "Pinning failed.",
        ),
      )
      .finally(() => setWorkingId(null));
  };

  const remove = (record: LibraryRecord) => {
    setWorkingId(record.id);
    void deleteLibraryRecord(record.id)
      .then(() => removeRecord(record.id))
      .catch((deleteError) =>
        setLibraryError(
          deleteError instanceof Error
            ? deleteError.message
            : "The library item could not be removed.",
        ),
      )
      .finally(() => setWorkingId(null));
  };

  const clearAll = () => {
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setClearArmed(false);
    void clearLibrary()
      .then(() => setLibrary([]))
      .catch((clearError) =>
        setLibraryError(
          clearError instanceof Error
            ? clearError.message
            : "The local library could not be cleared.",
        ),
      );
  };

  return (
    <div className="library-panel">
      <div className="library-window-intro">
        <div>
          <span className="eyebrow">DEVICE-LOCAL SOURCE VAULT</span>
          <strong>
            {library.length} saved torrent{library.length === 1 ? "" : "s"}
          </strong>
          <p>
            Reconnect without hunting for the original magnet or manifest.
            Sources never leave this browser.
          </p>
        </div>
        {storage ? (
          <div className="library-storage-status">
            <span>
              <i aria-hidden="true" />
              {storage.backend === "indexeddb" ? "INDEXEDDB" : "SESSION MEMORY"}
            </span>
            <strong>{formatBytes(storage.sourceBytes)} sources</strong>
            <small>{storage.persisted ? "Durable storage" : "Browser-managed storage"}</small>
          </div>
        ) : null}
      </div>

      <div className="library-toolbar">
        <label className="library-search">
          <Search aria-hidden="true" size={15} />
          <span className="sr-only">Search saved torrents</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, file, or info hash..."
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear library search"
              onClick={() => setQuery("")}
            >
              <X aria-hidden="true" size={13} />
            </button>
          ) : null}
        </label>
        <div className="library-filters" aria-label="Library filters">
          {(["all", "pinned", "recent"] as const).map((item) => (
            <button
              className={filter === item ? "active" : ""}
              type="button"
              key={item}
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <label className="library-sort">
          <span className="sr-only">Sort library</span>
          <select
            value={sort}
            onChange={(event) =>
              setSort(event.target.value as "recent" | "title" | "progress")
            }
          >
            <option value="recent">Recent first</option>
            <option value="title">Title A–Z</option>
            <option value="progress">Most watched</option>
          </select>
        </label>
      </div>

      {error ? (
        <div className="inline-error library-error" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <div>
            <strong>Library operation interrupted</strong>
            <p>{error}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Dismiss library error"
            onClick={() => setLibraryError(null)}
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}

      {visibleRecords.length ? (
        <div className="library-session-list">
          <AnimatePresence initial={false}>
            {visibleRecords.map((record, index) => (
              <motion.article
                key={record.id}
                layout={!reduceMotion}
                initial={reduceMotion ? false : { opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ delay: Math.min(index, 5) * 0.035 }}
              >
                <button
                  className="library-open-button"
                  type="button"
                  onClick={() => onOpen(record)}
                  disabled={loading || workingId === record.id}
                >
                  <span className="library-item-icon" aria-hidden="true">
                    {record.sourceKind === "magnet" ? (
                      <Waypoints size={17} />
                    ) : (
                      <FileArchive size={17} />
                    )}
                  </span>
                  <span className="library-item-copy">
                    <strong>{record.title}</strong>
                    <small>
                      {record.selectedFilePath ||
                        record.torrentFileName ||
                        record.infoHash.slice(0, 16) + "…"}
                    </small>
                    <span className="library-item-progress" aria-hidden="true">
                      <i style={{ width: `${Math.round(record.progress * 100)}%` }} />
                    </span>
                  </span>
                  <span className="library-item-meta">
                    <strong>{Math.round(record.progress * 100)}%</strong>
                    <small>{formatRelativeSession(record.lastOpenedAt)}</small>
                  </span>
                </button>
                <div className="library-item-actions">
                  <button
                    type="button"
                    aria-label={record.pinned ? `Unpin ${record.title}` : `Pin ${record.title}`}
                    title={record.pinned ? "Unpin" : "Pin"}
                    onClick={() => togglePinned(record)}
                    disabled={workingId === record.id}
                  >
                    {record.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  </button>
                  <button
                    className="danger-icon"
                    type="button"
                    aria-label={`Remove ${record.title} from library`}
                    title="Remove"
                    onClick={() => remove(record)}
                    disabled={workingId === record.id}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      ) : library.length ? (
        <div className="library-empty compact">
          <Search aria-hidden="true" size={25} />
          <strong>No matching torrents</strong>
          <p>Try another search term or switch the active filter.</p>
          <button className="mini-button" type="button" onClick={() => setQuery("")}>
            Reset search
          </button>
        </div>
      ) : (
        <div className="library-empty">
          <BookOpen aria-hidden="true" size={28} />
          <strong>Your source vault is empty</strong>
          <p>
            Torrents you open are stored locally so you can reconnect later.
            Nothing is synced to an account.
          </p>
        </div>
      )}

      <div className="library-bottom-row">
        <div className="library-local-note">
          <LockKeyhole aria-hidden="true" size={14} />
          <p>
            Raw magnets and .torrent bytes are isolated in IndexedDB and loaded
            only after you choose an item.
          </p>
        </div>
        {library.length ? (
          <button
            className={"mini-button " + (clearArmed ? "danger-confirm" : "")}
            type="button"
            onClick={clearAll}
          >
            <Trash2 aria-hidden="true" size={13} />
            {clearArmed ? "Confirm clear all" : "Clear library"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TorrentFileRow({
  file,
  selected,
  onSelect,
}: {
  file: TorrentFileView;
  selected: boolean;
  onSelect(path: string): void;
}) {
  return (
    <label className={"file-row " + (selected ? "selected" : "")}>
      <input
        type="radio"
        name="torrent-media"
        value={file.path}
        checked={selected}
        onChange={() => onSelect(file.path)}
        disabled={!isPlayable(file)}
      />
      <span className="file-kind">
        <FileKindIcon category={file.category} />
      </span>
      <span className="file-name-cell">
        <strong title={file.path}>{file.name}</strong>
        <small>{file.path !== file.name ? file.path : file.extension.toUpperCase()}</small>
      </span>
      <CompatibilityBadge file={file} />
      <span className="file-size">{formatBytes(file.length)}</span>
      <span className="radio-pixel" aria-hidden="true">
        {selected ? <Check size={13} /> : null}
      </span>
    </label>
  );
}

interface FilesStageProps {
  onPlay(): void;
  onChangeSource(): void;
  onRetry(): void;
}

function FilesStage({ onPlay, onChangeSource, onRetry }: FilesStageProps) {
  const meta = useTorrentStore((state) => state.meta);
  const files = useTorrentStore((state) => state.files);
  const selectedFilePath = useTorrentStore((state) => state.selectedFilePath);
  const selectFile = useTorrentStore((state) => state.selectFile);
  const metrics = useTorrentStore((state) => state.metrics);
  const peerNotice = useTorrentStore((state) => state.peerNotice);
  const setPeerNotice = useTorrentStore((state) => state.setPeerNotice);
  const reduceMotion = useReducedMotion();
  const selected = files.find((file) => file.path === selectedFilePath) || null;
  const grouped = {
    video: files.filter((file) => file.category === "video"),
    audio: files.filter((file) => file.category === "audio"),
    subtitle: files.filter((file) => file.category === "subtitle"),
    other: files.filter(
      (file) => file.category === "other" || file.category === "image",
    ),
  };

  if (!meta) return null;

  return (
    <section className="files-stage" aria-labelledby="files-title">
      <div className="stage-title-row">
        <div>
          <span className="chapter-label">
            <i aria-hidden="true" />
            FILE MANIFEST / SELECT PAYLOAD
          </span>
          <h1 id="files-title">{meta.name}</h1>
          <p>
            Metadata decoded. Ranked by likely playability and media size—choose
            the payload you want the piece scheduler to prioritize.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={onChangeSource}>
          <RotateCcw aria-hidden="true" size={15} />
          Change source
        </button>
      </div>

      <div className="metric-rack" aria-label="Torrent statistics">
        <MetricChip
          icon={<Users aria-hidden="true" size={18} />}
          label="Active peers"
          value={String(metrics.peers).padStart(2, "0")}
        />
        <MetricChip
          icon={<Download aria-hidden="true" size={18} />}
          label="Ingress"
          value={formatSpeed(metrics.downloadSpeed)}
        />
        <MetricChip
          icon={<ArrowUp aria-hidden="true" size={18} />}
          label="Egress"
          value={formatSpeed(metrics.uploadSpeed)}
        />
        <MetricChip
          icon={<FileArchive aria-hidden="true" size={18} />}
          label="Payload"
          value={formatBytes(meta.length)}
        />
      </div>

      {peerNotice ? (
        <PeerNotice
          message={peerNotice}
          onRetry={onRetry}
          onDismiss={() => setPeerNotice(null)}
        />
      ) : null}

      {selected ? (
        <motion.div
          className="recommended-card"
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <div className="recommended-art" aria-hidden="true">
            <span className="art-grid" />
            <Film size={34} />
            <i>01</i>
          </div>
          <div className="recommended-copy">
            <span className="best-match">
              <Sparkles aria-hidden="true" size={13} />
              SCHEDULER RECOMMENDATION
            </span>
            <h2>{selected.name}</h2>
            <p>
              {formatBytes(selected.length)} · {selected.extension.toUpperCase()} ·{" "}
              {selected.compatibility === "likely"
                ? "Likely to play in this browser"
                : "Playback depends on codecs installed in this browser"}
            </p>
          </div>
          <button className="arcade-button primary-action" type="button" onClick={onPlay}>
            <Play aria-hidden="true" size={18} fill="currentColor" />
            Prime &amp; play
            <ChevronRight aria-hidden="true" size={17} />
          </button>
        </motion.div>
      ) : (
        <div className="empty-media" role="status">
          <Search aria-hidden="true" size={28} />
          <h2>No playable media detected</h2>
          <p>
            The torrent loaded, but it does not contain a supported video or
            audio extension. You can still inspect every file below.
          </p>
        </div>
      )}

      <div className="file-browser">
        <div className="browser-toolbar">
          <div>
            <span className="eyebrow">DECODED MANIFEST</span>
            <strong>{files.length} objects discovered</strong>
          </div>
          <span className="selection-hint">Select one media file</span>
        </div>

        <div className="file-groups" role="radiogroup" aria-label="Media files">
          {(
            [
              ["video", "Video files"],
              ["audio", "Audio files"],
              ["subtitle", "Subtitle files"],
              ["other", "Other files"],
            ] as Array<[keyof typeof grouped, string]>
          ).map(([key, label]) =>
            grouped[key].length ? (
              <section className="file-group" key={key}>
                <h2>
                  {label}
                  <span>{grouped[key].length}</span>
                </h2>
                <div className="file-list">
                  {grouped[key].map((file) => (
                    <TorrentFileRow
                      key={file.path}
                      file={file}
                      selected={selectedFilePath === file.path}
                      onSelect={selectFile}
                    />
                  ))}
                </div>
              </section>
            ) : null,
          )}
        </div>
      </div>

      {selected ? (
        <div className="mobile-sticky-action">
          <span>
            <small>Selected</small>
            <strong>{selected.name}</strong>
          </span>
          <button className="arcade-button primary-action" type="button" onClick={onPlay}>
            <Play aria-hidden="true" size={17} fill="currentColor" />
            Play
          </button>
        </div>
      ) : null}
    </section>
  );
}

interface InspectorContentProps {
  panel: InspectorPanel;
  onSwitchFile(path: string): void;
  onSubtitleUpload(file: File): void;
  onRetry(): void;
}

function StreamInspector({ onRetry }: { onRetry(): void }) {
  const metrics = useTorrentStore((state) => state.metrics);
  const metricSamples = useTorrentStore((state) => state.metricSamples);
  const stream = useTorrentStore((state) => state.stream);
  const recentSamples = metricSamples.slice(-32);
  const chartPeak = Math.max(
    1,
    ...recentSamples.map((sample) => sample.downloadSpeed),
  );
  const selectedProgress = metrics.selectedFileProgress;
  const nativeTransport = metrics.transportMode === "native-bridge";
  const sourceTransports = metrics.sourceTransports;
  const nativeTrackerRoutes = sourceTransports
    ? sourceTransports.wssTrackers +
      sourceTransports.udpTrackers +
      sourceTransports.httpTrackers +
      sourceTransports.otherTrackers
    : 0;
  const transportLabel = !nativeTransport
    ? "WEBRTC / WSS"
    : stream?.playbackKind === "hls"
      ? "NATIVE / HLS"
      : stream?.playbackKind === "remux"
        ? "NATIVE / MP4 REMUX"
        : stream?.playbackKind === "transcode"
          ? "NATIVE / TRANSCODE"
          : "NATIVE / HTTP RANGE";

  return (
    <div className="inspector-content stream-panel">
      <div className="inspector-intro">
        <span className="eyebrow">LIVE SWARM TELEMETRY</span>
        <strong>Transport diagnostics</strong>
      </div>
      <div className="stream-health">
        <span className={metrics.peers ? "online" : "searching"}>
          <i aria-hidden="true" />
          {metrics.peers
            ? nativeTransport
              ? "Native peer transport online"
              : "WebRTC transport online"
            : nativeTransport
              ? "Native peer discovery active"
              : "Tracker mesh scanning"}
        </span>
        <strong>{metrics.peers}</strong>
        <small>{metrics.peers === 1 ? "connected peer" : "connected peers"}</small>
      </div>
      <div className="peer-topology" aria-label="Peer topology">
        {nativeTransport ? (
          <>
            <span>
              <small>Native peers</small>
              <strong>{metrics.peers}</strong>
            </span>
            <span>
              <small>UDP trackers</small>
              <strong>{sourceTransports?.udpTrackers ?? 0}</strong>
            </span>
            <span>
              <small>HTTP trackers</small>
              <strong>{sourceTransports?.httpTrackers ?? 0}</strong>
            </span>
            <span>
              <small>Source trackers</small>
              <strong>{nativeTrackerRoutes}</strong>
            </span>
          </>
        ) : (
          <>
            <span>
              <small>WebRTC</small>
              <strong>{metrics.connectedWebRtcPeers ?? 0}</strong>
            </span>
            <span>
              <small>Web seeds</small>
              <strong>{metrics.connectedWebSeeds ?? 0}</strong>
            </span>
            <span>
              <small>Pulling data</small>
              <strong>{metrics.activeDownloadPeers ?? 0}</strong>
            </span>
            <span>
              <small>Unchoked</small>
              <strong>{metrics.unchokedPeers ?? 0}</strong>
            </span>
          </>
        )}
      </div>

      <section className="throughput-chart" aria-label="Recent download throughput">
        <div>
          <span>DOWNLINK · LAST {recentSamples.length || 0} SAMPLES</span>
          <strong>{formatSpeed(metrics.downloadSpeed)}</strong>
        </div>
        <div className="throughput-bars" aria-hidden="true">
          {recentSamples.length ? (
            recentSamples.map((sample) => (
              <i
                key={sample.at}
                style={{
                  height: `${Math.max(3, (sample.downloadSpeed / chartPeak) * 100)}%`,
                }}
              />
            ))
          ) : (
            <span>AWAITING PACKETS</span>
          )}
        </div>
        <small>Session peak {formatSpeed(metrics.peakDownloadSpeed ?? 0)}</small>
      </section>

      <dl className="stream-stats">
        <div>
          <dt>
            <ArrowDown aria-hidden="true" size={14} />
            Download
          </dt>
          <dd>{formatSpeed(metrics.downloadSpeed)}</dd>
        </div>
        <div>
          <dt>
            <ArrowUp aria-hidden="true" size={14} />
            Upload
          </dt>
          <dd>{formatSpeed(metrics.uploadSpeed)}</dd>
        </div>
        <div>
          <dt>
            <HardDriveDownload aria-hidden="true" size={14} />
            Verified
          </dt>
          <dd>{formatBytes(metrics.downloaded)}</dd>
        </div>
        <div>
          <dt>
            <Upload aria-hidden="true" size={14} />
            Sent
          </dt>
          <dd>{formatBytes(metrics.uploaded)}</dd>
        </div>
        <div>
          <dt>
            <Activity aria-hidden="true" size={14} />
            Share ratio
          </dt>
          <dd>{(metrics.ratio ?? 0).toFixed(2)}</dd>
        </div>
        <div>
          <dt>
            <Network aria-hidden="true" size={14} />
            Transport
          </dt>
          <dd>
            {transportLabel}
          </dd>
        </div>
      </dl>
      <div className="timing-grid" aria-label="Connection timing">
        <span>
          <small>Metadata</small>
          <strong>{formatLatency(metrics.timeToMetadataMs)}</strong>
        </span>
        <span>
          <small>First peer</small>
          <strong>{formatLatency(metrics.timeToFirstPeerMs)}</strong>
        </span>
        <span>
          <small>First byte</small>
          <strong>{formatLatency(metrics.timeToFirstByteMs)}</strong>
        </span>
        <span>
          <small>Torrent ETA</small>
          <strong>{formatDurationMs(metrics.timeRemaining)}</strong>
        </span>
      </div>
      <div className="diagnostic-strip" aria-label="Low-level transfer counters">
        <span>
          <small>Piece size</small>
          <strong>{metrics.pieceLength ? formatBytes(metrics.pieceLength) : "—"}</strong>
        </span>
        <span>
          <small>Wire bytes</small>
          <strong>{formatBytes(metrics.received ?? metrics.downloaded)}</strong>
        </span>
        <span>
          <small>
            {metrics.transportMode === "native-bridge"
              ? "Native peers"
              : "Tracker replies"}
          </small>
          <strong>
            {metrics.transportMode === "native-bridge"
              ? metrics.peers
              : metrics.trackerAnnounces ?? 0}
          </strong>
        </span>
        <span>
          <small>
            {metrics.transportMode === "native-bridge"
              ? "Native routes"
              : "Peer offers"}
          </small>
          <strong>
            {metrics.transportMode === "native-bridge"
              ? (metrics.sourceTransports?.udpTrackers ?? 0) +
                (metrics.sourceTransports?.httpTrackers ?? 0) +
                (metrics.sourceTransports?.otherTrackers ?? 0)
              : metrics.trackerPeerCandidates ?? 0}
          </strong>
        </span>
        {nativeTransport ? (
          <span>
            <small>Session warnings</small>
            <strong>{metrics.sessionWarnings ?? 0}</strong>
          </span>
        ) : (
          <>
            <span>
              <small>Reported population</small>
              <strong>{metrics.reportedSwarmPopulation ?? 0}</strong>
            </span>
            <span>
              <small>Reannounces</small>
              <strong>{metrics.reannounceAttempts ?? 0}</strong>
            </span>
            <span>
              <small>Route warnings</small>
              <strong>{metrics.trackerWarnings ?? 0}</strong>
            </span>
          </>
        )}
        <span>
          <small>Stalled</small>
          <strong>{formatDurationMs(metrics.stalledForMs ?? 0)}</strong>
        </span>
      </div>
      <div className="torrent-progress">
        <div>
          <span>Verified torrent bytes</span>
          <strong>{Math.round(metrics.progress * 100)}%</strong>
        </div>
        <progress max={1} value={metrics.progress}>
          {Math.round(metrics.progress * 100)}%
        </progress>
        {selectedProgress !== null && selectedProgress !== undefined ? (
          <div className="selected-file-progress">
            <span>Selected file</span>
            <strong>{Math.round(selectedProgress * 100)}%</strong>
          </div>
        ) : null}
        <p>
          Torrent completion and media-buffer health are different signals. A
          stream can start long before this reaches 100%.
        </p>
      </div>
      {metrics.trackers?.length ? (
        <section className="tracker-matrix" aria-labelledby="tracker-matrix-title">
          <div>
            <span id="tracker-matrix-title">TRACKER MESH</span>
            <strong>
              {metrics.responsiveTrackers ?? 0}/{metrics.trackerCount ?? 0} responsive
            </strong>
          </div>
          <ul>
            {metrics.trackers.slice(0, 6).map((tracker) => (
              <li key={tracker.url}>
                <i className={tracker.status} aria-hidden="true" />
                <span title={tracker.url}>{trackerLabel(tracker.url)}</span>
                <small>{tracker.announces} announces</small>
              </li>
            ))}
          </ul>
          <p className="tracker-policy">
            {metrics.publicTrackerFallbacks
              ? "Official public WebTorrent fallbacks active"
              : "Using the torrent's declared tracker policy"}
          </p>
          {metrics.sourceTransports ? (
            <p className="tracker-policy">
              Source profile: {metrics.sourceTransports.wssTrackers} WSS ·{" "}
              {metrics.sourceTransports.udpTrackers +
                metrics.sourceTransports.httpTrackers +
                metrics.sourceTransports.otherTrackers}{" "}
              non-WSS · {metrics.sourceTransports.webSeeds} web seeds ·{" "}
              {metrics.sourceTransports.exactSources} exact sources
            </p>
          ) : null}
        </section>
      ) : null}
      {metrics.transportMode === "native-bridge" && metrics.sourceTransports ? (
        <section className="tracker-matrix" aria-label="Native bridge transport">
          <div>
            <span>NATIVE BRIDGE</span>
            <strong>{metrics.peers} peers connected</strong>
          </div>
          <p className="tracker-policy">
            Localhost transport active: {metrics.sourceTransports.udpTrackers} UDP ·{" "}
            {metrics.sourceTransports.httpTrackers} HTTP(S) ·{" "}
            {metrics.sourceTransports.wssTrackers} WSS source trackers. DHT and
            conventional TCP peers are also available when the swarm advertises them.
            Converted playback is served only to this local app.
          </p>
          {metrics.lastWarning ? (
            <p className="tracker-policy">Latest bridge warning: {metrics.lastWarning}</p>
          ) : null}
        </section>
      ) : null}
      {(metrics.recoverableWebRtcErrors ?? 0) > 0 ? (
        <div className="recoverable-rtc-note">
          <Activity aria-hidden="true" size={14} />
          <p>
            <strong>
              {metrics.recoverableWebRtcErrors} candidate warning
              {metrics.recoverableWebRtcErrors === 1 ? "" : "s"}
            </strong>
            Normal during peer negotiation; failed candidates were skipped while
            the remaining routes stayed active.
          </p>
        </div>
      ) : null}
      <button className="secondary-button full-width" type="button" onClick={onRetry}>
        <RefreshCw aria-hidden="true" size={15} />
        {nativeTransport ? "Restart native session" : "Refresh peer routes"}
      </button>
      <div className="cast-note">
        <MonitorPlay aria-hidden="true" size={18} />
        <p>
          Google Cast is disabled because a TV cannot fetch this
          browser-local stream. AirPlay appears only when Safari reports it as
          available and compatible.
        </p>
      </div>
    </div>
  );
}

function InspectorContent({
  panel,
  onSwitchFile,
  onSubtitleUpload,
  onRetry,
}: InspectorContentProps) {
  const files = useTorrentStore((state) => state.files);
  const selectedFilePath = useTorrentStore((state) => state.selectedFilePath);
  const meta = useTorrentStore((state) => state.meta);
  const subtitles = useTorrentStore((state) => state.subtitles);
  const activeSubtitleId = useTorrentStore((state) => state.activeSubtitleId);
  const setActiveSubtitle = useTorrentStore((state) => state.setActiveSubtitle);
  const subtitleOffset = useTorrentStore((state) => state.subtitleOffset);
  const setSubtitleOffset = useTorrentStore((state) => state.setSubtitleOffset);
  const subtitleError = useTorrentStore((state) => state.subtitleError);
  const playable = files.filter(isPlayable);
  const uploadRef = useRef<HTMLInputElement>(null);

  if (panel === "files") {
    return (
      <div className="inspector-content">
        <div className="inspector-intro">
          <span className="eyebrow">NOW PLAYING FROM</span>
          <strong>{meta?.name}</strong>
        </div>
        <div className="inspector-file-list">
          {playable.map((file, index) => (
            <button
              className={
                "inspector-file " +
                (file.path === selectedFilePath ? "active" : "")
              }
              type="button"
              key={file.path}
              onClick={() => onSwitchFile(file.path)}
            >
              <span className="queue-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <strong>{file.name}</strong>
                <small>
                  {formatBytes(file.length)} · {file.extension.toUpperCase()}
                </small>
              </span>
              {file.path === selectedFilePath ? (
                <span className="playing-bars" aria-label="Now playing">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <Play aria-hidden="true" size={15} />
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (panel === "captions") {
    const applyOffset = (delta: number) => {
      const next = Math.max(
        -60,
        Math.min(60, Math.round((subtitleOffset + delta) * 10) / 10),
      );
      setSubtitleOffset(next);
    };

    return (
      <div className="inspector-content captions-panel">
        <div className="inspector-intro">
          <span className="eyebrow">TEXT TRACK</span>
          <strong>Subtitles</strong>
        </div>

        <div className="caption-track-list" role="radiogroup" aria-label="Subtitle track">
          <label className={!activeSubtitleId ? "active" : ""}>
            <input
              type="radio"
              name="caption-track"
              checked={!activeSubtitleId}
              onChange={() => setActiveSubtitle(null)}
            />
            <span>Off</span>
            {!activeSubtitleId ? <Check size={14} /> : null}
          </label>
          {subtitles.map((track) => (
            <label
              className={activeSubtitleId === track.id ? "active" : ""}
              key={track.id}
            >
              <input
                type="radio"
                name="caption-track"
                checked={activeSubtitleId === track.id}
                onChange={() => setActiveSubtitle(track.id)}
              />
              <span>
                {track.name}
                <small>
                  {track.source === "torrent" ? "From torrent" : "Local file"}
                </small>
              </span>
              {activeSubtitleId === track.id ? <Check size={14} /> : null}
            </label>
          ))}
        </div>

        <input
          ref={uploadRef}
          className="sr-only"
          type="file"
          accept=".srt,.vtt,.ass,.ssa"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onSubtitleUpload(file);
            event.target.value = "";
          }}
        />
        <button
          className="secondary-button full-width"
          type="button"
          onClick={() => uploadRef.current?.click()}
        >
          <Upload aria-hidden="true" size={15} />
          Add subtitle file
        </button>
        {subtitleError ? (
          <p className="field-error" role="alert">
            <AlertTriangle aria-hidden="true" size={14} />
            {subtitleError}
          </p>
        ) : null}

        <div className="offset-panel">
          <div className="offset-heading">
            <span>
              <small>Subtitle sync</small>
              <strong>Offset</strong>
            </span>
            <output
              className={
                "offset-output " + (subtitleOffset === 0 ? "zero" : "")
              }
            >
              {subtitleOffset > 0 ? "+" : ""}
              {subtitleOffset.toFixed(1)}s
            </output>
          </div>
          <div className="offset-controls">
            {[-0.5, -0.1, 0.1, 0.5].map((delta) => (
              <button
                className="mini-button"
                type="button"
                key={delta}
                onClick={() => applyOffset(delta)}
              >
                {delta > 0 ? "+" : ""}
                {delta.toFixed(1)}
              </button>
            ))}
            <button
              className="mini-button reset"
              type="button"
              onClick={() => setSubtitleOffset(0)}
            >
              Reset
            </button>
          </div>
          <p>
            <kbd>Z</kbd> earlier · <kbd>X</kbd> later · hold Shift for 0.5s
          </p>
        </div>
      </div>
    );
  }

  return <StreamInspector onRetry={onRetry} />;
}

function WatchStage({
  onSwitchFile,
  onChangeSource,
  onSubtitleUpload,
  onRetry,
}: {
  onSwitchFile(path: string): void;
  onChangeSource(): void;
  onSubtitleUpload(file: File): void;
  onRetry(): void;
}) {
  const stream = useTorrentStore((state) => state.stream);
  const meta = useTorrentStore((state) => state.meta);
  const files = useTorrentStore((state) => state.files);
  const subtitles = useTorrentStore((state) => state.subtitles);
  const activeSubtitleId = useTorrentStore((state) => state.activeSubtitleId);
  const setActiveSubtitle = useTorrentStore((state) => state.setActiveSubtitle);
  const subtitleOffset = useTorrentStore((state) => state.subtitleOffset);
  const setSubtitleOffset = useTorrentStore((state) => state.setSubtitleOffset);
  const preferences = useTorrentStore((state) => state.preferences);
  const setPreferences = useTorrentStore((state) => state.setPreferences);
  const inspectorPanel = useTorrentStore((state) => state.inspectorPanel);
  const setInspectorPanel = useTorrentStore((state) => state.setInspectorPanel);
  const mobilePanel = useTorrentStore((state) => state.mobilePanel);
  const setMobilePanel = useTorrentStore((state) => state.setMobilePanel);
  const showFiles = useTorrentStore((state) => state.showFiles);
  const error = useTorrentStore((state) => state.error);
  const setError = useTorrentStore((state) => state.setError);

  useEffect(() => {
    if (!meta || !stream) return;
    try {
      localStorage.setItem(
        subtitleOffsetKey(meta.infoHash, stream.file.path),
        String(subtitleOffset),
      );
    } catch {
      // Subtitle timing still works when storage is unavailable.
    }
  }, [meta, stream, subtitleOffset]);

  if (!stream || !meta) return null;
  const activeSubtitle =
    subtitles.find((track) => track.id === activeSubtitleId) || null;
  const tabs: Array<{
    id: InspectorPanel;
    label: string;
    icon: ReactNode;
  }> = [
    {
      id: "files",
      label: "Files",
      icon: <Film aria-hidden="true" size={16} />,
    },
    {
      id: "captions",
      label: "Captions",
      icon: <Captions aria-hidden="true" size={16} />,
    },
    {
      id: "stream",
      label: "Stream",
      icon: <Network aria-hidden="true" size={16} />,
    },
  ];

  return (
    <section className="watch-stage" aria-labelledby="watch-title">
      <div className="watch-title-row">
        <button className="back-button" type="button" onClick={showFiles}>
          <ArrowLeft aria-hidden="true" size={17} />
          Files
        </button>
        <div>
          <span className="eyebrow">NOW PLAYING</span>
          <h1 id="watch-title">{stream.file.name}</h1>
        </div>
        <button className="secondary-button" type="button" onClick={onChangeSource}>
          <RotateCcw aria-hidden="true" size={15} />
          Change source
        </button>
      </div>

      {error ? (
        <div className="playback-error" role="alert">
          <AlertTriangle aria-hidden="true" size={20} />
          <div>
            <strong>This file is not playing</strong>
            <p>{error}</p>
          </div>
          <button className="mini-button active" type="button" onClick={onRetry}>
            Retry
          </button>
          <button
            className="mini-button"
            type="button"
            onClick={() => {
              setError(null);
              showFiles();
            }}
          >
            Choose another
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Dismiss playback error"
            onClick={() => {
              setError(null);
              showFiles();
            }}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}

      <div className="watch-layout">
        <div className="watch-main">
          {error ? (
            <div className="player-frame player-module-loading" role="status">
              <AlertTriangle aria-hidden="true" size={28} />
              <span className="eyebrow">PLAYBACK STOPPED</span>
              <strong>Retry the torrent session or choose another file.</strong>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="player-frame player-module-loading" role="status">
                  <div className="pixel-loader" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="eyebrow">LOADING PLAYER MODULE</span>
                  <strong>Preparing the local media pipeline…</strong>
                </div>
              }
            >
              <RetroPlayer
                stream={stream}
                meta={meta}
                subtitle={activeSubtitle}
                subtitleOffset={subtitleOffset}
                preferences={preferences}
                onPreferences={(next: Partial<PlayerPreferences>) => {
                  setPreferences(next);
                  const merged = {
                    ...useTorrentStore.getState().preferences,
                    ...next,
                  };
                  localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
                }}
                onSubtitleToggle={() =>
                  setActiveSubtitle(activeSubtitleId ? null : subtitles[0]?.id || null)
                }
                onSubtitleOffset={(offset) =>
                  setSubtitleOffset(
                    Math.max(-60, Math.min(60, Math.round(offset * 10) / 10)),
                  )
                }
                onPlaybackError={(message) =>
                  setError(
                    message +
                      (stream.playbackKind === "direct"
                        ? " Direct browser mode streams the original file and cannot convert unsupported codecs."
                        : ""),
                  )
                }
              />
            </Suspense>
          )}

          <div className="media-summary">
            <div>
              <span className="eyebrow">CURRENT FILE</span>
              <strong>{stream.file.name}</strong>
              <p>
                {formatBytes(stream.file.length)} ·{" "}
                {stream.file.extension.toUpperCase()} ·{" "}
                {stream.file.compatibility === "likely"
                  ? "Browser-compatible container"
                  : "Experimental browser playback"}
              </p>
            </div>
            <div className="media-summary-actions">
              <span>
                <Subtitles aria-hidden="true" size={15} />
                {activeSubtitle ? activeSubtitle.name : "Captions off"}
              </span>
              <span>
                <Settings2 aria-hidden="true" size={15} />
                {preferences.playbackRate}x speed
              </span>
            </div>
          </div>
        </div>

        <aside className="desktop-inspector" aria-label="Player inspector">
          <div className="inspector-tabs" role="tablist" aria-label="Player panels">
            {tabs.map((tab) => (
              <button
                type="button"
                role="tab"
                aria-selected={inspectorPanel === tab.id}
                className={inspectorPanel === tab.id ? "active" : ""}
                key={tab.id}
                onClick={() => setInspectorPanel(tab.id)}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
          <InspectorContent
            panel={inspectorPanel}
            onSwitchFile={onSwitchFile}
            onSubtitleUpload={onSubtitleUpload}
            onRetry={onRetry}
          />
        </aside>
      </div>

      <div className="mobile-inspector-tabs" aria-label="Player panels">
        {tabs.map((tab) => (
          <button type="button" key={tab.id} onClick={() => setMobilePanel(tab.id)}>
            {tab.icon}
            {tab.label}
            <ChevronRight aria-hidden="true" size={15} />
          </button>
        ))}
      </div>

      {tabs.map((tab) => (
        <MobileSheet
          key={tab.id}
          open={mobilePanel === tab.id}
          title={tab.label}
          onClose={() => setMobilePanel(null)}
        >
          <InspectorContent
            panel={tab.id}
            onSwitchFile={(path) => {
              onSwitchFile(path);
              setMobilePanel(null);
            }}
            onSubtitleUpload={onSubtitleUpload}
            onRetry={onRetry}
          />
        </MobileSheet>
      ))}

      <span className="sr-only" aria-live="polite">
        Playing {stream.file.name}. {files.length} torrent files available.
      </span>
    </section>
  );
}

function HeaderConnectionStatus() {
  const phase = useTorrentStore((state) => state.phase);
  const peers = useTorrentStore((state) => state.metrics.peers);
  const label =
    phase === "idle"
      ? "ENGINE READY"
      : phase === "streaming"
        ? peers
          ? `${peers} PEER${peers === 1 ? "" : "S"} ONLINE`
          : "DISCOVERING PEERS"
        : phase === "waiting"
          ? "HANDSHAKE PENDING"
          : phase === "failed"
            ? "ENGINE INTERRUPTED"
            : phase.toUpperCase();

  return (
    <span className={"system-led " + (phase === "failed" ? "danger" : "")}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

export function TorrentPlayerApp() {
  const reduceMotion = useReducedMotion();
  const view = useTorrentStore((state) => state.view);
  const phase = useTorrentStore((state) => state.phase);
  const phaseMessage = useTorrentStore((state) => state.phaseMessage);
  const error = useTorrentStore((state) => state.error);
  const peerNotice = useTorrentStore((state) => state.peerNotice);
  const history = useTorrentStore((state) => state.history);
  const library = useTorrentStore((state) => state.library);
  const libraryOpen = useTorrentStore((state) => state.libraryOpen);
  const helpOpen = useTorrentStore((state) => state.helpOpen);
  const whyOpen = useTorrentStore((state) => state.whyOpen);
  const setHelpOpen = useTorrentStore((state) => state.setHelpOpen);
  const setWhyOpen = useTorrentStore((state) => state.setWhyOpen);
  const setHistory = useTorrentStore((state) => state.setHistory);
  const setLibrary = useTorrentStore((state) => state.setLibrary);
  const setLibraryOpen = useTorrentStore((state) => state.setLibraryOpen);
  const setLibraryLoading = useTorrentStore((state) => state.setLibraryLoading);
  const setLibraryError = useTorrentStore((state) => state.setLibraryError);
  const upsertLibraryRecord = useTorrentStore(
    (state) => state.upsertLibraryRecord,
  );
  const resetSession = useTorrentStore((state) => state.resetSession);
  const [changeConfirmOpen, setChangeConfirmOpen] = useState(false);
  const [globalDrag, setGlobalDrag] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    void listResumeRecords().then(setHistory);
    setLibraryLoading(true);
    void listLibraryRecords()
      .then(setLibrary)
      .catch((libraryLoadError) =>
        setLibraryError(
          libraryLoadError instanceof Error
            ? libraryLoadError.message
            : "The local library could not be opened.",
        ),
      )
      .finally(() => setLibraryLoading(false));
    try {
      const stored =
        localStorage.getItem(PREFS_KEY) ||
        localStorage.getItem(LEGACY_PREFS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<PlayerPreferences>;
        const restored: Partial<PlayerPreferences> = {};
        if (typeof parsed.volume === "number") {
          restored.volume = Math.max(0, Math.min(1, parsed.volume));
        }
        if (typeof parsed.muted === "boolean") {
          restored.muted = parsed.muted;
        }
        if (typeof parsed.playbackRate === "number") {
          restored.playbackRate = parsed.playbackRate;
        }
        useTorrentStore.getState().setPreferences(restored);
      }
    } catch {
      // Preferences are optional and recover automatically.
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "?") {
        event.preventDefault();
        useTorrentStore.getState().setHelpOpen(true);
      }
      if (event.key === "Escape") {
        useTorrentStore.getState().setHelpOpen(false);
        useTorrentStore.getState().setWhyOpen(false);
        useTorrentStore.getState().setMobilePanel(null);
        setChangeConfirmOpen(false);
      }
    };
    const onBeforeUnload = () => {
      void torrentClient.destroyCurrent();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", onBeforeUnload);
      resetSession();
      void torrentClient.destroyCurrent();
    };
  }, [resetSession, setHistory, setLibrary, setLibraryError, setLibraryLoading]);

  const loadTorrentSubtitles = async (
    infoHash: string,
    files: TorrentFileView[],
  ) => {
    const subtitleFiles = files
      .filter((file) => file.category === "subtitle")
      .slice(0, 12);
    const tracks = await Promise.all(
      subtitleFiles.map(async (file): Promise<SubtitleTrackModel | null> => {
        const format = inferSubtitleFormat(file.name);
        if (!format) return null;
        try {
          const language = getLanguageFromFilename(file.name);
          return {
            id: "torrent-" + file.path,
            name:
              language.label === "Subtitle"
                ? file.name.replace(/\.[^.]+$/, "")
                : language.label,
            language: language.code,
            format,
            content: await torrentClient.readTextFile(file.path),
            source: "torrent",
            path: file.path,
          };
        } catch {
          return null;
        }
      }),
    );
    if (useTorrentStore.getState().meta?.infoHash === infoHash) {
      useTorrentStore
        .getState()
        .setSubtitles(tracks.filter((track): track is SubtitleTrackModel => Boolean(track)));
    }
  };

  const startSource = (
    source: TorrentSource,
    options: {
      preferredFilePath?: string | null;
      persistSource?: boolean;
    } = {},
  ) => {
    const { preferredFilePath, persistSource = false } = options;
    resetSession();
    useTorrentStore
      .getState()
      .setPhase("initializing", "Selecting the best local P2P transport...");
    void torrentClient.load(source, {
      onPhase: (nextPhase, message) =>
        useTorrentStore.getState().setPhase(nextPhase, message),
      onReady: (meta, files) => {
        const state = useTorrentStore.getState();
        state.setReady(meta, files);
        if (
          preferredFilePath &&
          files.some((file) => file.path === preferredFilePath && isPlayable(file))
        ) {
          state.selectFile(preferredFilePath);
        }
        if (persistSource) {
          void saveLibraryRecord({
            consent: true,
            infoHash: meta.infoHash,
            title: meta.name,
            totalBytes: meta.length,
            selectedFilePath: preferredFilePath,
            source:
              typeof source.value === "string"
                ? { kind: "magnet", value: source.value }
                : {
                    kind: "torrent",
                    value: source.value,
                    fileName: source.label,
                  },
          })
            .then(upsertLibraryRecord)
            .catch((librarySaveError) =>
              setLibraryError(
                librarySaveError instanceof Error
                  ? librarySaveError.message
                  : "This source could not be saved to the local library.",
              ),
            );
        }
        void loadTorrentSubtitles(meta.infoHash, files);
      },
      onMetrics: (nextMetrics) =>
        useTorrentStore.getState().setMetrics(nextMetrics),
      onNoPeers: (message) =>
        useTorrentStore.getState().setPeerNotice(message),
      onError: (message) => {
        useTorrentStore.getState().setError(message);
        useTorrentStore.getState().setPhase("failed", "Connection failed.");
      },
    });
  };

  const cancelSource = () => {
    void torrentClient.destroyCurrent().finally(() => resetSession());
  };

  const playSelected = () => {
    const state = useTorrentStore.getState();
    if (!state.selectedFilePath || !state.meta) return;
    try {
      const stream = torrentClient.getStream(state.selectedFilePath);
      const savedOffset =
        localStorage.getItem(
          subtitleOffsetKey(state.meta.infoHash, stream.file.path),
        ) ||
        localStorage.getItem(
          legacySubtitleOffsetKey(state.meta.infoHash, stream.file.path),
        );
      const storedOffset = savedOffset === null ? 0 : Number(savedOffset);
      state.setSubtitleOffset(Number.isFinite(storedOffset) ? storedOffset : 0);
      state.beginWatch(stream);
      void updateLibraryRecord(state.meta.infoHash, {
        selectedFilePath: stream.file.path,
      }).then((record) => {
        if (record) upsertLibraryRecord(record);
      });
    } catch (streamError) {
      state.setError(
        streamError instanceof Error
          ? streamError.message
          : "The selected file could not be prepared.",
      );
    }
  };

  const switchFile = (path: string) => {
    const state = useTorrentStore.getState();
    state.selectFile(path);
    try {
      const stream = torrentClient.getStream(path);
      if (state.meta) {
        const savedOffset =
          localStorage.getItem(
            subtitleOffsetKey(state.meta.infoHash, stream.file.path),
          ) ||
          localStorage.getItem(
            legacySubtitleOffsetKey(state.meta.infoHash, stream.file.path),
          );
        const storedOffset = savedOffset === null ? 0 : Number(savedOffset);
        state.setSubtitleOffset(Number.isFinite(storedOffset) ? storedOffset : 0);
      }
      state.beginWatch(stream);
      if (state.meta) {
        void updateLibraryRecord(state.meta.infoHash, {
          selectedFilePath: stream.file.path,
        }).then((record) => {
          if (record) upsertLibraryRecord(record);
        });
      }
    } catch (streamError) {
      state.setError(
        streamError instanceof Error
          ? streamError.message
          : "The selected file could not be prepared.",
      );
    }
  };

  const uploadSubtitle = (file: File) => {
    void subtitleFromUpload(file)
      .then((track) => useTorrentStore.getState().addSubtitle(track))
      .catch((subtitleError) =>
        useTorrentStore
          .getState()
          .setSubtitleError(
            subtitleError instanceof Error
              ? subtitleError.message
              : "That subtitle file could not be read.",
          ),
      );
  };

  const retry = () => {
    const state = useTorrentStore.getState();
    // Unmount the failed media provider before creating a fresh signed bridge
    // session so hls.js cannot keep polling the expired manifest URL.
    if (state.view === "watch") state.showFiles();
    state.setError(null);
    state.setPeerNotice(null);
    void torrentClient.retry();
  };

  const confirmChangeSource = () => {
    setChangeConfirmOpen(false);
    void torrentClient.destroyCurrent().finally(() => resetSession());
  };

  const handleGlobalDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setGlobalDrag(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    void sourceFromTorrentFile(file)
      .then(startSource)
      .catch((dropError) =>
        useTorrentStore
          .getState()
          .setError(
            dropError instanceof Error
              ? dropError.message
              : "That file could not be opened.",
          ),
      );
  };

  const openNewSession = () => {
    if (view === "landing" && phase === "idle") {
      document.getElementById("magnet-input")?.focus();
      return;
    }
    setChangeConfirmOpen(true);
  };

  const openLibraryItem = (record: LibraryRecord) => {
    setLibraryLoading(true);
    setLibraryError(null);
    void getLibrarySource(record.id)
      .then(async (storedSource) => {
        if (!storedSource) {
          throw new Error(
            "The private source payload is missing. Remove this entry and add the torrent again.",
          );
        }
        const source: TorrentSource =
          storedSource.kind === "magnet"
            ? sourceFromMagnet(storedSource.value)
            : { value: storedSource.value, label: storedSource.fileName };
        setLibraryOpen(false);
        startSource(source, { preferredFilePath: record.selectedFilePath });
        const touched = await touchLibraryRecord(record.id);
        if (touched) upsertLibraryRecord(touched);
      })
      .catch((libraryOpenError) => {
        setLibraryOpen(true);
        setLibraryError(
          libraryOpenError instanceof Error
            ? libraryOpenError.message
            : "The saved torrent could not be reopened.",
        );
      })
      .finally(() => setLibraryLoading(false));
  };

  return (
    <main
      className="app-shell"
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        if (event.dataTransfer.types.includes("Files")) setGlobalDrag(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setGlobalDrag(false);
      }}
      onDrop={handleGlobalDrop}
    >
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="scanline-overlay" aria-hidden="true" />
      <header className="site-header">
        <div className="header-brand-zone">
          <button
            className="brand"
            type="button"
            onClick={openNewSession}
            aria-label="NerdTorrentPlayer home"
          >
            <span className="brand-mark" aria-hidden="true">
              <Waypoints size={16} />
              <i />
            </span>
            <span className="brand-copy">
              <strong>NerdTorrent</strong>
              <small>Player</small>
            </span>
          </button>
          <span className="build-channel">WEB / P2P</span>
        </div>

        <div className="header-status">
          <HeaderConnectionStatus />
          <span className="browser-mode">
            {view === "landing" ? "LOAD" : view === "files" ? "MANIFEST" : "PLAYER"}
            <b aria-hidden="true">/</b>
            {view === "landing" ? "01" : view === "files" ? "02" : "03"}
          </span>
        </div>

        <nav className="header-nav" aria-label="Primary navigation">
          <button className="nav-primary" type="button" onClick={openNewSession}>
            <Upload aria-hidden="true" size={15} />
            <span>New stream</span>
          </button>
          <button type="button" onClick={() => setLibraryOpen(true)}>
            <BookOpen aria-hidden="true" size={16} />
            <span>Library</span>
            {library.length ? (
              <b className="nav-count" aria-label={`${library.length} saved torrents`}>
                {Math.min(library.length, 99)}
              </b>
            ) : null}
          </button>
          <button
            className="nav-icon-button"
            type="button"
            onClick={() => setWhyOpen(true)}
            aria-label="About browser torrent streaming"
            title="About"
          >
            <CircleHelp aria-hidden="true" size={16} />
          </button>
          <button
            className="nav-icon-button"
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
          >
            <Keyboard aria-hidden="true" size={16} />
            <kbd>?</kbd>
          </button>
        </nav>
      </header>

      <div id="main-content" className="page-content">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            className="view-transition"
            key={view}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -7 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: "easeOut" }}
          >
            {view === "landing" ? (
              <HomeStage
                phase={phase}
                phaseMessage={phaseMessage}
                peerNotice={peerNotice}
                error={error}
                history={history}
                onStart={(source, persistSource) =>
                  startSource(source, { persistSource })
                }
                onDemo={(persistSource) =>
                  startSource(SINTEL_DEMO_SOURCE, { persistSource })
                }
                onCancel={cancelSource}
                onRetry={retry}
                onDismissPeerNotice={() =>
                  useTorrentStore.getState().setPeerNotice(null)
                }
                onWhy={() => setWhyOpen(true)}
                onOpenLibrary={() => setLibraryOpen(true)}
                onClearHistory={() =>
                  void clearResumeRecords().then(() => setHistory([]))
                }
              />
            ) : null}
            {view === "files" ? (
              <FilesStage
                onPlay={playSelected}
                onChangeSource={() => setChangeConfirmOpen(true)}
                onRetry={retry}
              />
            ) : null}
            {view === "watch" ? (
              <WatchStage
                onSwitchFile={switchFile}
                onChangeSource={() => setChangeConfirmOpen(true)}
                onSubtitleUpload={uploadSubtitle}
                onRetry={retry}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="site-footer">
        <div className="footer-brand">
          <span className="footer-mark" aria-hidden="true">
            <Waypoints size={15} />
            <i />
          </span>
          <span>
            <strong>NerdTorrentPlayer</strong>
            <small>Local-first hybrid P2P streaming</small>
          </span>
        </div>
        <div className="footer-safety">
          <ShieldCheck aria-hidden="true" size={15} />
          <span>
            <strong>Peer-visible connection</strong>
            <small>Your IP and traffic are visible to the torrent swarm.</small>
          </span>
        </div>
        <p className="footer-credit">
          Built with love ❤️ by{" "}
          <a
            href="http://gautamvhavle.xyz/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Gautam Vhavle
            <ExternalLink aria-hidden="true" size={11} />
          </a>
        </p>
      </footer>

      {globalDrag ? (
        <div className="global-drop-overlay" role="status">
          <div>
            <Upload aria-hidden="true" size={34} />
            <span className="eyebrow">DROP TO LOAD</span>
            <strong>Release your .torrent file</strong>
          </div>
        </div>
      ) : null}

      <Modal
        open={libraryOpen}
        title="Torrent source vault"
        onClose={() => setLibraryOpen(false)}
        className="library-modal"
      >
        <LibraryPanel onOpen={openLibraryItem} />
      </Modal>

      <Modal
        open={whyOpen}
        title="How transport modes work"
        onClose={() => setWhyOpen(false)}
      >
        <div className="explain-grid">
          <article>
            <Wifi aria-hidden="true" size={20} />
            <div>
              <strong>WebRTC peers only</strong>
              <p>
                Hosted browser mode uses WSS trackers, WebRTC peers, web seeds,
                and exact metadata sources without a torrent backend.
              </p>
            </div>
          </article>
          <article>
            <HardDriveDownload aria-hidden="true" size={20} />
            <div>
              <strong>Stream, do not wait</strong>
              <p>
                The player requests file ranges as you watch and seeks to new
                pieces when you jump on the timeline.
              </p>
            </div>
          </article>
          <article>
            <ShieldCheck aria-hidden="true" size={20} />
            <div>
              <strong>Private localhost bridge</strong>
              <p>
                On localhost, the optional helper unlocks UDP trackers, DHT, and
                conventional TCP peers. It binds only to 127.0.0.1 and requires
                short-lived capability tokens from this app.
              </p>
            </div>
          </article>
          <article>
            <AlertTriangle aria-hidden="true" size={20} />
            <div>
              <strong>Browser-safe playback</strong>
              <p>
                Native MP4/WebM files keep byte-range seeking. MKV video uses a
                local sliding HLS window when ffmpeg is available; copied source
                codecs must still be supported by the browser.
              </p>
            </div>
          </article>
        </div>
      </Modal>

      <Modal
        open={helpOpen}
        title="Keyboard shortcuts"
        onClose={() => setHelpOpen(false)}
        className="shortcuts-modal"
      >
        <div className="shortcut-grid">
          {[
            ["K / Space", "Play or pause"],
            ["J / L", "Back or forward 10 seconds"],
            ["← / →", "Back or forward 5 seconds"],
            ["↑ / ↓", "Volume up or down"],
            ["M", "Mute"],
            ["C", "Toggle captions"],
            ["F", "Fullscreen"],
            ["P", "Picture in picture"],
            ["Z / X", "Subtitle earlier or later"],
            ["Shift + Z / X", "Subtitle ±0.5 seconds"],
            ["0", "Reset subtitle offset"],
            ["Esc", "Close the top panel"],
          ].map(([keys, action]) => (
            <div key={keys}>
              <kbd>{keys}</kbd>
              <span>{action}</span>
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={changeConfirmOpen}
        title="Leave this swarm?"
        onClose={() => setChangeConfirmOpen(false)}
      >
        <div className="confirm-dialog">
          <AlertTriangle aria-hidden="true" size={26} />
          <p>
            Changing the source stops the current stream and disconnects this
            browser from its peers. Your playback save point stays on this
            device.
          </p>
          <div className="confirm-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setChangeConfirmOpen(false)}
            >
              Keep watching
            </button>
            <button
              className="arcade-button danger-action"
              type="button"
              onClick={confirmChangeSource}
            >
              Disconnect
            </button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
