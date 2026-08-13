"use client";

import {
  AirPlayButton,
  CaptionButton,
  Captions,
  Controls,
  FullscreenButton,
  MediaAnnouncer,
  MediaPlayer,
  MediaProvider,
  MuteButton,
  PIPButton,
  PlayButton,
  Time,
  TimeSlider,
  Track,
  VolumeSlider,
  isHLSProvider,
  useMediaRemote,
  useMediaState,
  type MediaErrorDetail,
  type MediaProviderAdapter,
  type MediaSrc,
  type MediaPlayerInstance,
  type MediaTimeUpdateEventDetail,
  type MediaVolumeChange,
} from "@vidstack/react";
import {
  Airplay,
  Captions as CaptionsIcon,
  Cast,
  Gauge,
  Maximize,
  Minimize,
  SkipForward,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  getResumeRecord,
  saveResumeRecord,
  type ResumeRecord,
} from "../lib/history";
import { updateLibraryRecord } from "../lib/library";
import {
  subtitleToVtt,
  type SubtitleTrackModel,
} from "../subtitles/subtitle-parser";
import { formatSpeed } from "../torrent/torrent-files";
import type {
  StreamSource,
  TorrentMeta,
} from "../torrent/torrent-types";
import {
  useTorrentStore,
  type PlayerPreferences,
} from "../stores/torrent-store";

interface RetroPlayerProps {
  stream: StreamSource;
  meta: TorrentMeta;
  subtitle: SubtitleTrackModel | null;
  subtitleOffset: number;
  preferences: PlayerPreferences;
  onPreferences(preferences: Partial<PlayerPreferences>): void;
  onSubtitleToggle(): void;
  onSubtitleOffset(offset: number): void;
  onPlaybackError(message: string): void;
  nextFileName?: string;
  onNextFile?(): void;
}

type BufferingReason = "initial" | "waiting" | "stalled" | null;

const PLAYBACK_SAVE_INTERVAL_MS = 5_000;
const PLAYBACK_DEBUG = process.env.NODE_ENV !== "production";

function logPlaybackDiagnostic(event: string, details: Record<string, unknown>) {
  if (!PLAYBACK_DEBUG) return;
  console.info("[Torrent playback]", event, details);
}

function bufferedSecondsAhead(buffered: TimeRanges, currentTime: number) {
  try {
    for (let index = 0; index < buffered.length; index += 1) {
      const start = buffered.start(index);
      const end = buffered.end(index);
      if (currentTime >= start - 0.25 && currentTime <= end + 0.25) {
        return Math.max(0, end - currentTime);
      }
    }
  } catch {
    // A browser can replace TimeRanges while it is being read.
  }
  return 0;
}

function formatBufferAhead(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 1) return "<1s";
  if (seconds < 60) return Math.floor(seconds) + "s";
  return Math.floor(seconds / 60) + "m " + Math.floor(seconds % 60) + "s";
}

function playbackErrorMessage(
  detail: MediaErrorDetail,
  playbackKind?: StreamSource["playbackKind"],
) {
  switch (detail.code) {
    case 1:
      if (playbackKind === "hls") {
        return "The local HLS window did not become ready before this attempt ended. If peer speed is below the media bitrate, let the swarm warm up and retry.";
      }
      return "Playback was interrupted before it finished. Press play to retry the current range.";
    case 2:
      return "The browser lost the local torrent stream. Keep this tab open while the swarm reconnects, then retry.";
    case 3:
      if (playbackKind === "hls") {
        return "The local HLS stream arrived, but this browser cannot decode one of its copied audio or video codecs.";
      }
      return "The file arrived, but this browser cannot decode its audio or video codec. Try another media file or browser.";
    case 4:
      if (playbackKind === "hls") {
        return "The local HLS playlist could not be loaded or decoded. Check the bridge warning in Stream diagnostics.";
      }
      return "This stream could not be decoded. Direct browser mode requires a supported container and codec; the localhost bridge can remux or transcode compatible sources when active.";
    default:
      return (
        detail.message ||
        "Playback could not continue. Check the swarm and try this file again."
      );
  }
}

function PlayerControls({
  hasCaptions,
  stream,
  onPreferences,
  nextFileName,
  onNextFile,
}: {
  hasCaptions: boolean;
  stream: StreamSource;
  onPreferences(preferences: Partial<PlayerPreferences>): void;
  nextFileName?: string;
  onNextFile?(): void;
}) {
  const remote = useMediaRemote();
  const paused = useMediaState("paused");
  const muted = useMediaState("muted");
  const volume = useMediaState("volume");
  const fullscreen = useMediaState("fullscreen");
  const pictureInPicture = useMediaState("pictureInPicture");
  const canPictureInPicture = useMediaState("canPictureInPicture");
  const canFullscreen = useMediaState("canFullscreen");
  const canAirPlay = useMediaState("canAirPlay");
  const playbackRate = useMediaState("playbackRate");
  const downloadSpeed = useTorrentStore(
    (state) => state.metrics.downloadSpeed,
  );
  const hlsPlayback = stream.playbackKind === "hls";

  const cycleSpeed = () => {
    const rates = [0.75, 1, 1.25, 1.5, 2];
    const index = rates.indexOf(playbackRate);
    const next = rates[(index + 1) % rates.length];
    remote.changePlaybackRate(next);
    onPreferences({ playbackRate: next });
  };

  return (
    <Controls.Root className="player-controls">
      <Controls.Group className="timeline-row">
        <TimeSlider.Root
          className="time-slider"
          aria-label={hlsPlayback ? "Seek within the available HLS window" : "Seek through media"}
        >
          <TimeSlider.Track className="slider-track">
            <TimeSlider.Progress className="slider-progress" />
            <TimeSlider.TrackFill className="slider-fill" />
          </TimeSlider.Track>
          <TimeSlider.Thumb className="slider-thumb" />
          <TimeSlider.Preview className="time-preview">
            <TimeSlider.Value />
          </TimeSlider.Preview>
        </TimeSlider.Root>
      </Controls.Group>

      <Controls.Group className="transport-row">
        <div className="transport-cluster">
          <PlayButton
            className="player-button primary-player-button"
            aria-label={paused ? "Play" : "Pause"}
            title={paused ? "Play (K)" : "Pause (K)"}
          >
            {paused ? (
              <Play aria-hidden="true" size={19} fill="currentColor" />
            ) : (
              <Pause aria-hidden="true" size={19} fill="currentColor" />
            )}
          </PlayButton>

          <div className="time-readout" aria-label="Playback time">
            <Time type="current" />
            {hlsPlayback ? (
              <span title="This timeline grows as the local bridge converts the torrent">
                GROWING TIMELINE
              </span>
            ) : (
              <>
                <span aria-hidden="true">/</span>
                <Time type="duration" />
              </>
            )}
          </div>

          <MuteButton
            className="player-button"
            aria-label={muted ? "Unmute" : "Mute"}
            title={muted ? "Unmute (M)" : "Mute (M)"}
          >
            {muted || volume === 0 ? (
              <VolumeX aria-hidden="true" size={19} />
            ) : volume < 0.5 ? (
              <Volume1 aria-hidden="true" size={19} />
            ) : (
              <Volume2 aria-hidden="true" size={19} />
            )}
          </MuteButton>

          <VolumeSlider.Root className="volume-slider" aria-label="Volume">
            <VolumeSlider.Track className="slider-track">
              <VolumeSlider.TrackFill className="slider-fill" />
            </VolumeSlider.Track>
            <VolumeSlider.Thumb className="slider-thumb" />
          </VolumeSlider.Root>
        </div>

        <div className="transport-cluster transport-actions">
          <span className="player-net-stat" title="Current torrent download rate">
            <i aria-hidden="true" />
            {formatSpeed(downloadSpeed)}
          </span>

          {nextFileName && onNextFile ? (
            <button
              className="player-button next-player-button"
              type="button"
              aria-label={"Play next file: " + nextFileName}
              title={"Next episode: " + nextFileName}
              onClick={onNextFile}
            >
              <SkipForward aria-hidden="true" size={19} />
            </button>
          ) : null}

          <CaptionButton
            className="player-button"
            aria-label="Toggle captions"
            title="Captions (C)"
            disabled={!hasCaptions}
          >
            <CaptionsIcon aria-hidden="true" size={19} />
          </CaptionButton>

          <button
            className="player-button speed-button"
            type="button"
            aria-label={"Playback speed " + playbackRate + " times"}
            title="Change playback speed"
            onClick={cycleSpeed}
          >
            <Gauge aria-hidden="true" size={17} />
            <span>{playbackRate}x</span>
          </button>

          {canPictureInPicture ? (
            <PIPButton
              className="player-button optional-player-button"
              aria-label={
                pictureInPicture
                  ? "Exit picture in picture"
                  : "Enter picture in picture"
              }
              title="Picture in picture (P)"
            >
              <PictureInPicture2 aria-hidden="true" size={19} />
            </PIPButton>
          ) : null}

          {canAirPlay ? (
            <AirPlayButton
              className="player-button optional-player-button"
              aria-label="Try AirPlay"
              title="AirPlay availability depends on Safari, the device, and the media codec"
            >
              <Airplay aria-hidden="true" size={19} />
            </AirPlayButton>
          ) : null}

          <button
            className="player-button optional-player-button cast-disabled"
            type="button"
            aria-label="Google Cast unavailable for browser-local torrent streams"
            title="Google Cast needs a URL the TV can fetch; this stream exists only in your browser"
            disabled
          >
            <Cast aria-hidden="true" size={19} />
          </button>

          {canFullscreen ? (
            <FullscreenButton
              className="player-button"
              aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title="Fullscreen (F)"
            >
              {fullscreen ? (
                <Minimize aria-hidden="true" size={19} />
              ) : (
                <Maximize aria-hidden="true" size={19} />
              )}
            </FullscreenButton>
          ) : null}
        </div>
      </Controls.Group>
    </Controls.Root>
  );
}

function PlayerStatus({
  reason,
  stream,
}: {
  reason: BufferingReason;
  stream: StreamSource;
}) {
  const remote = useMediaRemote();
  const canPlay = useMediaState("canPlay");
  const paused = useMediaState("paused");
  const seeking = useMediaState("seeking");
  const peers = useTorrentStore((state) => state.metrics.peers);
  const downloadSpeed = useTorrentStore(
    (state) => state.metrics.downloadSpeed,
  );
  const nativeTransport = useTorrentStore(
    (state) => state.metrics.transportMode === "native-bridge",
  );
  const hlsPlayback = stream.playbackKind === "hls";

  const readyToStart = hlsPlayback && canPlay && paused && !reason && !seeking;

  if (readyToStart) {
    return (
      <div className="player-status-overlay player-ready-overlay" role="status">
        <span className="eyebrow">STREAM READY</span>
        <strong>Ready to play</strong>
        <button
          className="arcade-button primary-action player-ready-action"
          type="button"
          onClick={() => remote.play()}
        >
          <Play aria-hidden="true" size={18} fill="currentColor" />
          Start playback
        </button>
      </div>
    );
  }

  if ((canPlay && !reason && !seeking) || (canPlay && paused && !seeking)) {
    return null;
  }

  const eyebrow = seeking
    ? hlsPlayback
      ? "SEEKING HLS WINDOW"
      : "SEEKING BYTE RANGE"
    : !canPlay
      ? "PRIMING STREAM"
      : reason === "stalled"
        ? hlsPlayback
          ? "HLS SEGMENT STALLED"
          : "RANGE REQUEST STALLED"
        : "BUFFERING PIECES";
  const title = seeking
    ? hlsPlayback
      ? "Moving within the available HLS window"
      : "Jumping to the requested pieces"
    : !peers
      ? nativeTransport
        ? "Waiting for a native swarm peer"
        : "Negotiating a WebRTC route"
      : reason === "stalled"
        ? hlsPlayback
          ? "Waiting for the next local HLS segment"
          : "Waiting on this exact byte range"
        : !canPlay
          ? "Building the first playable buffer"
          : "Fetching the next contiguous pieces";
  const recovery = peers
    ? "Playback resumes automatically when the range is ready."
    : "No connected peer is serving this range yet; discovery stays active.";

  return (
    <div
      className="player-status-overlay"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="pixel-loader" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <span className="eyebrow">{eyebrow}</span>
      <strong>{title}</strong>
      <p>
        {peers} peer{peers === 1 ? "" : "s"} · {formatSpeed(downloadSpeed)}
        {" · "}
        {recovery}
      </p>
    </div>
  );
}

function PlayerStatusStrip({
  bufferStatusRef,
  mediaStatusRef,
}: {
  bufferStatusRef: RefObject<HTMLSpanElement | null>;
  mediaStatusRef: RefObject<HTMLSpanElement | null>;
}) {
  const peers = useTorrentStore((state) => state.metrics.peers);
  const downloadSpeed = useTorrentStore(
    (state) => state.metrics.downloadSpeed,
  );

  return (
    <div className="player-status-strip">
      <span className="online-label">
        <i aria-hidden="true" />
        P2P {peers ? "ONLINE" : "SEARCHING"}
      </span>
      <span>{peers} peers</span>
      <span>{formatSpeed(downloadSpeed)}</span>
      <span ref={bufferStatusRef} aria-label="Buffer state unavailable">
        BUFFER -
      </span>
      <span ref={mediaStatusRef} className="status-strip-note">
        LOADING
      </span>
    </div>
  );
}

export function RetroPlayer({
  stream,
  meta,
  subtitle,
  subtitleOffset,
  preferences,
  onPreferences,
  onSubtitleToggle,
  onSubtitleOffset,
  onPlaybackError,
  nextFileName,
  onNextFile,
}: RetroPlayerProps) {
  const playerRef = useRef<MediaPlayerInstance>(null);
  const bufferStatusRef = useRef<HTMLSpanElement>(null);
  const mediaStatusRef = useRef<HTMLSpanElement>(null);
  const [bufferingReason, setBufferingReason] =
    useState<BufferingReason>("initial");
  const [resumeRecord, setResumeRecord] = useState<ResumeRecord | null>(null);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const lastSaveAt = useRef(0);
  const playbackSaveBusy = useRef(false);
  const resumeLoadRequest = useRef(0);

  const subtitleContent = useMemo(() => {
    if (!subtitle) return null;
    try {
      return subtitleToVtt(
        subtitle.content,
        subtitle.format,
        subtitleOffset,
      );
    } catch {
      return null;
    }
  }, [subtitle, subtitleOffset]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.volume = preferences.volume;
    player.muted = preferences.muted;
    player.playbackRate = preferences.playbackRate;
  }, [
    preferences.muted,
    preferences.playbackRate,
    preferences.volume,
    stream.url,
  ]);

  const loadResume = useCallback(async () => {
    const request = ++resumeLoadRequest.current;
    const record = await getResumeRecord(meta.infoHash, stream.file.path).catch(
      () => null,
    );
    if (request !== resumeLoadRequest.current) return;
    if (
      record &&
      record.position > 10 &&
      (!record.duration || record.position < record.duration - 15)
    ) {
      setResumeRecord(record);
      setResumeDismissed(false);
    } else {
      setResumeRecord(null);
    }
  }, [meta.infoHash, stream.file.path]);

  const handleLoadStart = useCallback(() => {
    resumeLoadRequest.current += 1;
    lastSaveAt.current = 0;
    setBufferingReason("initial");
    setResumeRecord(null);
    setResumeDismissed(false);
    logPlaybackDiagnostic("load-start", {
      playbackKind: stream.playbackKind,
      streamType: stream.streamType ?? "on-demand",
      url: stream.url,
    });
  }, [stream.playbackKind, stream.streamType, stream.url]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    return player.subscribe(
      ({ buffered, canPlay, currentTime, ended, error, paused, playing, seeking, waiting }) => {
        const bufferNode = bufferStatusRef.current;
        if (bufferNode) {
          const ahead = bufferedSecondsAhead(buffered, currentTime);
          const value = formatBufferAhead(ahead);
          bufferNode.textContent = "BUFFER " + value;
          bufferNode.setAttribute("aria-label", value + " buffered ahead");
        }

        const mediaNode = mediaStatusRef.current;
        if (mediaNode) {
          const phase = error
            ? "MEDIA ERROR"
            : ended
              ? "ENDED"
              : seeking
                ? "SEEKING"
                : waiting
                  ? "BUFFERING"
                  : playing
                    ? "PLAYING"
                    : canPlay && paused
                      ? "PAUSED"
                      : canPlay
                        ? "READY"
                        : "LOADING";
          mediaNode.textContent = phase;
          mediaNode.dataset.state = phase.toLowerCase().replace(" ", "-");
        }
      },
    );
  }, [stream.url]);

  const persistPlaybackSnapshot = useCallback(
    (currentTime: number) => {
      const now = Date.now();
      if (
        playbackSaveBusy.current ||
        now - lastSaveAt.current < PLAYBACK_SAVE_INTERVAL_MS ||
        currentTime < 1
      ) {
        return;
      }

      const duration = Number.isFinite(playerRef.current?.duration)
        ? playerRef.current?.duration || 0
        : 0;
      lastSaveAt.current = now;
      playbackSaveBusy.current = true;

      const resume: ResumeRecord = {
        id: meta.infoHash + ":" + stream.file.path,
        infoHash: meta.infoHash,
        torrentName: meta.name,
        filePath: stream.file.path,
        fileName: stream.file.name,
        position: currentTime,
        duration,
        subtitleOffset,
        lastOpenedAt: now,
      };

      // Both on-device records share the existing five-second cadence. Library
      // failures are deliberately isolated from media playback.
      void Promise.allSettled([
        saveResumeRecord(resume),
        updateLibraryRecord(meta.infoHash, {
          selectedFilePath: stream.file.path,
          position: currentTime,
          duration,
          progress: duration > 0 ? Math.min(1, currentTime / duration) : 0,
        }),
      ]).finally(() => {
        playbackSaveBusy.current = false;
      });
    },
    [meta.infoHash, meta.name, stream.file.name, stream.file.path, subtitleOffset],
  );

  const handleTimeUpdate = useCallback(
    (detail: MediaTimeUpdateEventDetail) => {
      persistPlaybackSnapshot(detail.currentTime);
    },
    [persistPlaybackSnapshot],
  );

  const handleVolumeChange = useCallback(
    (detail: MediaVolumeChange) => {
      onPreferences({ volume: detail.volume, muted: detail.muted });
    },
    [onPreferences],
  );

  const handleRateChange = useCallback(
    (rate: number) => onPreferences({ playbackRate: rate }),
    [onPreferences],
  );

  const handlePlaybackError = useCallback(
    (detail: MediaErrorDetail) => {
      setBufferingReason(null);
      logPlaybackDiagnostic("media-error", {
        code: detail.code,
        message: detail.message,
        playbackKind: stream.playbackKind,
        url: stream.url,
      });
      onPlaybackError(playbackErrorMessage(detail, stream.playbackKind));
    },
    [onPlaybackError, stream.playbackKind, stream.url],
  );

  const handleProviderChange = useCallback(
    (provider: MediaProviderAdapter | null) => {
      if (!isHLSProvider(provider)) return;
      // A torrent-backed manifest can legitimately wait while its first
      // contiguous media range arrives. hls.js defaults are tuned for an HTTP
      // origin that already has a manifest, so give this local producer time
      // to build the initial live window without declaring a fatal error.
      provider.config = {
        debug: false,
        manifestLoadingTimeOut: 120_000,
        // A missing localhost bridge session will not recover by hammering the
        // same signed manifest URL. Keep a few retries for a cold HLS producer,
        // then let the app surface one actionable playback error.
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1_000,
        manifestLoadingMaxRetryTimeout: 5_000,
        // ffmpeg can publish a playlist fractionally before the corresponding
        // local segment becomes visible. Retry those short-lived requests
        // instead of treating them as a terminal media failure.
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 500,
        fragLoadingMaxRetryTimeout: 5_000,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 500,
        levelLoadingMaxRetryTimeout: 5_000,
      };
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches(
          "input, textarea, select, button, [contenteditable='true']",
        )
      ) {
        return;
      }
      const player = playerRef.current;
      if (!player) return;
      const key = event.key.toLowerCase();

      if (key === " " || key === "k") {
        event.preventDefault();
        void (player.paused ? player.play() : player.pause()).catch(
          () => undefined,
        );
      } else if (key === "j") {
        event.preventDefault();
        player.currentTime = Math.max(0, player.currentTime - 10);
      } else if (key === "l") {
        event.preventDefault();
        player.currentTime = Math.min(
          player.duration || Infinity,
          player.currentTime + 10,
        );
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        player.currentTime = Math.max(0, player.currentTime - 5);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        player.currentTime = Math.min(
          player.duration || Infinity,
          player.currentTime + 5,
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        player.volume = Math.min(1, player.volume + 0.05);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        player.volume = Math.max(0, player.volume - 0.05);
      } else if (key === "m") {
        event.preventDefault();
        player.muted = !player.muted;
      } else if (key === "c") {
        event.preventDefault();
        onSubtitleToggle();
      } else if (key === "f") {
        event.preventDefault();
        void (document.fullscreenElement
          ? player.exitFullscreen()
          : player.enterFullscreen()
        ).catch(() => undefined);
      } else if (key === "p") {
        event.preventDefault();
        void (document.pictureInPictureElement
          ? player.exitPictureInPicture()
          : player.enterPictureInPicture()
        ).catch(() => undefined);
      } else if (key === "z") {
        event.preventDefault();
        onSubtitleOffset(
          subtitleOffset + (event.shiftKey ? -0.5 : -0.1),
        );
      } else if (key === "x") {
        event.preventDefault();
        onSubtitleOffset(
          subtitleOffset + (event.shiftKey ? 0.5 : 0.1),
        );
      } else if (key === "0") {
        event.preventDefault();
        onSubtitleOffset(0);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSubtitleOffset, onSubtitleToggle, subtitleOffset]);

  const chooseResume = (resume: boolean) => {
    if (resume && resumeRecord && playerRef.current) {
      playerRef.current.currentTime = resumeRecord.position;
    }
    setResumeDismissed(true);
  };

  return (
    <div className="player-frame">
      <MediaPlayer
        ref={playerRef}
        className="retro-media-player"
        title={stream.file.name}
        ariaLabel={"NerdTorrentPlayer: " + stream.file.name}
        src={{ src: stream.url, type: stream.mime } as MediaSrc}
        viewType={stream.file.category === "audio" ? "audio" : "video"}
        streamType={stream.streamType ?? "on-demand"}
        // Native HLS can take long enough to prepare that the original click's
        // browser activation expires. Requiring one explicit play press avoids
        // noisy, policy-rejected autoplay requests while the manifest warms up.
        autoPlay={stream.playbackKind !== "hls"}
        preload="metadata"
        playsInline
        keyDisabled
        onLoadStart={handleLoadStart}
        onProviderChange={handleProviderChange}
        onLoadedMetadata={() => void loadResume()}
        onCanPlay={() => setBufferingReason(null)}
        onPlaying={() => setBufferingReason(null)}
        onWaiting={() => setBufferingReason("waiting")}
        onStalled={() => setBufferingReason("stalled")}
        onTimeUpdate={handleTimeUpdate}
        onVolumeChange={handleVolumeChange}
        onRateChange={handleRateChange}
        onError={handlePlaybackError}
      >
        <MediaAnnouncer />
        <MediaProvider>
          {subtitle && subtitleContent ? (
            <Track
              key={subtitle.id + "-" + subtitleOffset}
              id={subtitle.id}
              content={subtitleContent}
              type="vtt"
              kind="subtitles"
              label={subtitle.name}
              lang={subtitle.language}
              default
            />
          ) : null}
        </MediaProvider>

        <div className="player-crt-shade" aria-hidden="true" />
        <Captions className="player-captions" />
        <PlayerStatus
          reason={bufferingReason}
          stream={stream}
        />

        {resumeRecord && !resumeDismissed ? (
          <div className="resume-prompt" role="dialog" aria-label="Resume playback">
            <RotateCcw aria-hidden="true" size={19} />
            <div>
              <span className="eyebrow">SAVE POINT FOUND</span>
              <strong>
                Resume at {Math.floor(resumeRecord.position / 60)}:
                {String(Math.floor(resumeRecord.position % 60)).padStart(2, "0")}
                ?
              </strong>
            </div>
            <button
              className="mini-button active"
              type="button"
              onClick={() => chooseResume(true)}
            >
              Resume
            </button>
            <button
              className="mini-button"
              type="button"
              onClick={() => chooseResume(false)}
            >
              Start over
            </button>
          </div>
        ) : null}

        <PlayerControls
          hasCaptions={Boolean(subtitleContent)}
          stream={stream}
          onPreferences={onPreferences}
          nextFileName={nextFileName}
          onNextFile={onNextFile}
        />
      </MediaPlayer>

      <PlayerStatusStrip
        bufferStatusRef={bufferStatusRef}
        mediaStatusRef={mediaStatusRef}
      />
    </div>
  );
}
