"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AudioLines,
  Captions,
  Check,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Clock3,
  Download,
  File,
  FileArchive,
  FileText,
  Film,
  Gamepad2,
  HardDriveDownload,
  Image as ImageIcon,
  Keyboard,
  LockKeyhole,
  MonitorPlay,
  Network,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Subtitles,
  Trash2,
  Upload,
  Users,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import {
  useEffect,
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
import { RetroPlayer } from "./RetroPlayer";

const PREFS_KEY = "torrent-exe:prefs:v1";

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
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry(): void;
  onDismiss(): void;
}) {
  return (
    <div className="peer-notice" role="status">
      <WifiOff aria-hidden="true" size={22} />
      <div>
        <strong>WebRTC peers not found yet</strong>
        <p>{message}</p>
      </div>
      <div className="inline-actions">
        <button className="mini-button active" type="button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" size={14} />
          Try again
        </button>
        <button className="mini-button" type="button" onClick={onDismiss}>
          Keep waiting
        </button>
      </div>
    </div>
  );
}

interface HomeStageProps {
  phase: ReturnType<typeof useTorrentStore.getState>["phase"];
  phaseMessage: string;
  peerNotice: string | null;
  error: string | null;
  history: ResumeRecord[];
  onStart(source: TorrentSource): void;
  onCancel(): void;
  onRetry(): void;
  onDismissPeerNotice(): void;
  onWhy(): void;
  onClearHistory(): void;
}

function HomeStage({
  phase,
  phaseMessage,
  peerNotice,
  error,
  history,
  onStart,
  onCancel,
  onRetry,
  onDismissPeerNotice,
  onWhy,
  onClearHistory,
}: HomeStageProps) {
  const [magnet, setMagnet] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const loading =
    phase === "initializing" || phase === "metadata" || phase === "waiting";

  const submitMagnet = (event: FormEvent) => {
    event.preventDefault();
    const validationError = validateMagnet(magnet);
    if (validationError) {
      setInputError(validationError);
      return;
    }
    setInputError(null);
    onStart(sourceFromMagnet(magnet));
  };

  const chooseTorrentFile = async (file?: File) => {
    if (!file) return;
    try {
      setInputError(null);
      onStart(await sourceFromTorrentFile(file));
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

  if (loading) {
    return (
      <section className="home-stage loading-stage" aria-labelledby="loading-title">
        <div className="loading-console">
          <div className="console-topline">
            <span className="eyebrow">BOOT SEQUENCE</span>
            <span className="live-code">P2P::ACTIVE</span>
          </div>
          <div className="loading-core" aria-live="polite">
            <div className="radar-loader" aria-hidden="true">
              <span />
              <i />
            </div>
            <span className="eyebrow">WEBTORRENT ENGINE</span>
            <h1 id="loading-title">{phaseMessage}</h1>
            <p>
              This may take a moment while the browser contacts secure WebSocket
              trackers and looks for WebRTC-compatible peers.
            </p>
          </div>

          <ol className="boot-steps" aria-label="Connection progress">
            <li className="complete">
              <Check aria-hidden="true" size={15} />
              Validate source
            </li>
            <li className={phase !== "initializing" ? "complete" : "active"}>
              {phase !== "initializing" ? (
                <Check aria-hidden="true" size={15} />
              ) : (
                <span aria-hidden="true">02</span>
              )}
              Start local engine
            </li>
            <li className={phase === "waiting" ? "active" : ""}>
              <span aria-hidden="true">03</span>
              Find peers + metadata
            </li>
          </ol>

          {peerNotice ? (
            <PeerNotice
              message={peerNotice}
              onRetry={onRetry}
              onDismiss={onDismissPeerNotice}
            />
          ) : null}

          <button className="text-button danger-text" type="button" onClick={onCancel}>
            <X aria-hidden="true" size={15} />
            Cancel connection
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="home-stage" aria-labelledby="home-title">
      <div className="hero-copy">
        <span className="chapter-label">
          <i aria-hidden="true" />
          LEVEL 01 · LOAD SOURCE
        </span>
        <h1 id="home-title">
          STREAM
          <span>THE SWARM</span>
        </h1>
        <p>
          Drop a torrent. Pick a file. Press play. Everything runs inside your
          browser with no account and no media server.
        </p>
      </div>

      <div className="source-console">
        <div className="console-topline">
          <span className="eyebrow">TORRENT INPUT</span>
          <span className="secure-indicator">
            <LockKeyhole aria-hidden="true" size={13} />
            LOCAL ONLY
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
          <label htmlFor="magnet-input">Magnet link</label>
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
              The link stays in this tab and is never saved to your history.
            </p>
          )}
          <button className="arcade-button primary-action" type="submit">
            <Play aria-hidden="true" size={18} fill="currentColor" />
            Connect to swarm
            <ChevronRight aria-hidden="true" size={17} />
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
            <strong>Drop a .torrent file here</strong>
            <small>or click to choose from your device</small>
          </span>
          <span className="file-tag">.TORRENT</span>
        </button>

        <button className="browser-limit" type="button" onClick={onWhy}>
          <Radio aria-hidden="true" size={15} />
          Browser mode connects to WebTorrent / WebRTC peers only.
          <span>Why?</span>
        </button>
      </div>

      {history.length ? (
        <section className="recent-panel" aria-labelledby="recent-title">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">LOCAL SAVE DATA</span>
              <h2 id="recent-title">Recent sessions</h2>
            </div>
            <button className="text-button" type="button" onClick={onClearHistory}>
              <Trash2 aria-hidden="true" size={14} />
              Clear
            </button>
          </div>
          <div className="recent-list">
            {history.slice(0, 3).map((record) => (
              <div className="recent-row" key={record.id}>
                <span className="recent-icon">
                  <Film aria-hidden="true" size={18} />
                </span>
                <span>
                  <strong>{record.fileName}</strong>
                  <small>{record.torrentName}</small>
                </span>
                <span className="recent-time">
                  <Clock3 aria-hidden="true" size={13} />
                  {Math.floor(record.position / 60)}m
                </span>
                <span className="recent-note">Re-open source to resume</span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="feature-grid" aria-label="Product features">
          <article>
            <Zap aria-hidden="true" size={21} />
            <strong>Play before complete</strong>
            <p>Pieces are fetched around playback and seek position.</p>
          </article>
          <article>
            <Subtitles aria-hidden="true" size={21} />
            <strong>Subtitle control</strong>
            <p>Load SRT, VTT, ASS, or SSA and fix timing on the fly.</p>
          </article>
          <article>
            <ShieldCheck aria-hidden="true" size={21} />
            <strong>Browser private</strong>
            <p>No login, media upload, database, or server-side library.</p>
          </article>
        </div>
      )}
    </section>
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
            LEVEL 02 · CHOOSE MEDIA
          </span>
          <h1 id="files-title">{meta.name}</h1>
          <p>
            Metadata loaded. Choose what you want to play; nothing starts until
            you press the play button.
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
          label="Peers"
          value={String(metrics.peers).padStart(2, "0")}
        />
        <MetricChip
          icon={<Download aria-hidden="true" size={18} />}
          label="Down"
          value={formatSpeed(metrics.downloadSpeed)}
        />
        <MetricChip
          icon={<ArrowUp aria-hidden="true" size={18} />}
          label="Up"
          value={formatSpeed(metrics.uploadSpeed)}
        />
        <MetricChip
          icon={<FileArchive aria-hidden="true" size={18} />}
          label="Total"
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
        <div className="recommended-card">
          <div className="recommended-art" aria-hidden="true">
            <span className="art-grid" />
            <Film size={34} />
            <i>01</i>
          </div>
          <div className="recommended-copy">
            <span className="best-match">
              <Sparkles aria-hidden="true" size={13} />
              BEST MATCH
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
            Play selected
            <ChevronRight aria-hidden="true" size={17} />
          </button>
        </div>
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
            <span className="eyebrow">TORRENT CONTENTS</span>
            <strong>{files.length} files found</strong>
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

function InspectorContent({
  panel,
  onSwitchFile,
  onSubtitleUpload,
  onRetry,
}: InspectorContentProps) {
  const files = useTorrentStore((state) => state.files);
  const selectedFilePath = useTorrentStore((state) => state.selectedFilePath);
  const metrics = useTorrentStore((state) => state.metrics);
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

  return (
    <div className="inspector-content stream-panel">
      <div className="inspector-intro">
        <span className="eyebrow">LIVE TELEMETRY</span>
        <strong>Swarm status</strong>
      </div>
      <div className="stream-health">
        <span className={metrics.peers ? "online" : "searching"}>
          <i aria-hidden="true" />
          {metrics.peers ? "P2P connection active" : "Searching for peers"}
        </span>
        <strong>{metrics.peers}</strong>
        <small>connected peers</small>
      </div>
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
            Received
          </dt>
          <dd>{formatBytes(metrics.downloaded)}</dd>
        </div>
      </dl>
      <div className="torrent-progress">
        <div>
          <span>Whole torrent progress</span>
          <strong>{Math.round(metrics.progress * 100)}%</strong>
        </div>
        <progress max={1} value={metrics.progress}>
          {Math.round(metrics.progress * 100)}%
        </progress>
        <p>
          This is byte completion, not the amount currently buffered by the
          video player.
        </p>
      </div>
      <button className="secondary-button full-width" type="button" onClick={onRetry}>
        <RefreshCw aria-hidden="true" size={15} />
        Reconnect to swarm
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
  const metrics = useTorrentStore((state) => state.metrics);
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
        "torrent-exe:subtitle-offset:" +
          meta.infoHash +
          ":" +
          stream.file.path,
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
          <button className="mini-button" type="button" onClick={showFiles}>
            Choose another
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Dismiss playback error"
            onClick={() => setError(null)}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}

      <div className="watch-layout">
        <div className="watch-main">
          <RetroPlayer
            stream={stream}
            meta={meta}
            metrics={metrics}
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
                  " This app streams the original file and does not transcode unsupported codecs.",
              )
            }
          />

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

export function TorrentPlayerApp() {
  const view = useTorrentStore((state) => state.view);
  const phase = useTorrentStore((state) => state.phase);
  const phaseMessage = useTorrentStore((state) => state.phaseMessage);
  const metrics = useTorrentStore((state) => state.metrics);
  const error = useTorrentStore((state) => state.error);
  const peerNotice = useTorrentStore((state) => state.peerNotice);
  const history = useTorrentStore((state) => state.history);
  const helpOpen = useTorrentStore((state) => state.helpOpen);
  const whyOpen = useTorrentStore((state) => state.whyOpen);
  const setHelpOpen = useTorrentStore((state) => state.setHelpOpen);
  const setWhyOpen = useTorrentStore((state) => state.setWhyOpen);
  const setHistory = useTorrentStore((state) => state.setHistory);
  const resetSession = useTorrentStore((state) => state.resetSession);
  const [changeConfirmOpen, setChangeConfirmOpen] = useState(false);
  const [globalDrag, setGlobalDrag] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    void listResumeRecords().then(setHistory);
    try {
      const stored = localStorage.getItem(PREFS_KEY);
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
      void torrentClient.destroyCurrent();
    };
  }, [setHistory]);

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

  const startSource = (source: TorrentSource) => {
    resetSession();
    useTorrentStore.getState().setPhase("initializing", "Starting the browser P2P engine...");
    void torrentClient.load(source, {
      onPhase: (nextPhase, message) =>
        useTorrentStore.getState().setPhase(nextPhase, message),
      onReady: (meta, files) => {
        useTorrentStore.getState().setReady(meta, files);
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
      const offsetKey =
        "torrent-exe:subtitle-offset:" +
        state.meta.infoHash +
        ":" +
        stream.file.path;
      const savedOffset = localStorage.getItem(offsetKey);
      const storedOffset = savedOffset === null ? 0 : Number(savedOffset);
      state.setSubtitleOffset(Number.isFinite(storedOffset) ? storedOffset : 0);
      state.beginWatch(stream);
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
        const offsetKey =
          "torrent-exe:subtitle-offset:" +
          state.meta.infoHash +
          ":" +
          stream.file.path;
        const savedOffset = localStorage.getItem(offsetKey);
        const storedOffset = savedOffset === null ? 0 : Number(savedOffset);
        state.setSubtitleOffset(Number.isFinite(storedOffset) ? storedOffset : 0);
      }
      state.beginWatch(stream);
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
    useTorrentStore.getState().setError(null);
    useTorrentStore.getState().setPeerNotice(null);
    if (view === "watch") {
      const path = useTorrentStore.getState().selectedFilePath;
      if (path) switchFile(path);
    } else {
      void torrentClient.retry();
    }
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
        <button
          className="brand"
          type="button"
          onClick={() => {
            if (view === "landing" && phase === "idle") return;
            setChangeConfirmOpen(true);
          }}
          aria-label="Torrent.exe home"
        >
          <span className="brand-mark" aria-hidden="true">
            <Play size={14} fill="currentColor" />
          </span>
          <span>
            TORRENT<span>.EXE</span>
          </span>
        </button>

        <div className="header-status">
          <span className={"system-led " + (phase === "failed" ? "danger" : "")}>
            <i aria-hidden="true" />
            {phase === "idle"
              ? "SYSTEM READY"
              : phase === "streaming"
                ? metrics.peers
                  ? "P2P ONLINE"
                  : "P2P SEARCHING"
                : phase.toUpperCase()}
          </span>
          <span className="browser-mode">BROWSER MODE</span>
        </div>

        <nav className="header-nav" aria-label="Help">
          <button type="button" onClick={() => setWhyOpen(true)}>
            <CircleHelp aria-hidden="true" size={16} />
            About
          </button>
          <button type="button" onClick={() => setHelpOpen(true)}>
            <Keyboard aria-hidden="true" size={16} />
            Shortcuts
            <kbd>?</kbd>
          </button>
        </nav>
      </header>

      <div id="main-content" className="page-content">
        {view === "landing" ? (
          <HomeStage
            phase={phase}
            phaseMessage={phaseMessage}
            peerNotice={peerNotice}
            error={error}
            history={history}
            onStart={startSource}
            onCancel={cancelSource}
            onRetry={retry}
            onDismissPeerNotice={() =>
              useTorrentStore.getState().setPeerNotice(null)
            }
            onWhy={() => setWhyOpen(true)}
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
      </div>

      <footer className="site-footer">
        <span>
          <Gamepad2 aria-hidden="true" size={15} />
          TORRENT.EXE · PLAY RESPONSIBLY
        </span>
        <span>
          Your IP and traffic are visible to peers in the torrent swarm.
        </span>
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
        open={whyOpen}
        title="How browser mode works"
        onClose={() => setWhyOpen(false)}
      >
        <div className="explain-grid">
          <article>
            <Wifi aria-hidden="true" size={20} />
            <div>
              <strong>WebRTC peers only</strong>
              <p>
                Browsers cannot open normal BitTorrent TCP or UDP connections.
                The torrent must have peers that support WebTorrent over WebRTC.
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
              <strong>No application backend</strong>
              <p>
                Torrent metadata and media stay in this tab. Resume position is
                stored only on this device; raw magnet links are not retained.
              </p>
            </div>
          </article>
          <article>
            <AlertTriangle aria-hidden="true" size={20} />
            <div>
              <strong>Original codecs</strong>
              <p>
                TORRENT.EXE does not transcode. MP4 H.264/AAC and WebM are the
                safest; MKV, AVI, HEVC, and unusual audio codecs may not play.
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
