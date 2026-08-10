"use client";

import {
  AirPlayButton,
  CaptionButton,
  Captions,
  Controls,
  FullscreenButton,
  MediaPlayer,
  MediaProvider,
  MuteButton,
  PIPButton,
  PlayButton,
  Time,
  TimeSlider,
  Track,
  VolumeSlider,
  useMediaRemote,
  useMediaState,
  type MediaPlayerInstance,
} from "@vidstack/react";
import {
  Airplay,
  Captions as CaptionsIcon,
  Cast,
  Gauge,
  Maximize,
  Minimize,
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
} from "react";
import {
  getResumeRecord,
  saveResumeRecord,
  type ResumeRecord,
} from "../lib/history";
import {
  subtitleToVtt,
  type SubtitleTrackModel,
} from "../subtitles/subtitle-parser";
import { formatSpeed } from "../torrent/torrent-files";
import type {
  StreamSource,
  TorrentMeta,
  TorrentMetrics,
} from "../torrent/torrent-types";
import type { PlayerPreferences } from "../stores/torrent-store";

interface RetroPlayerProps {
  stream: StreamSource;
  meta: TorrentMeta;
  metrics: TorrentMetrics;
  subtitle: SubtitleTrackModel | null;
  subtitleOffset: number;
  preferences: PlayerPreferences;
  onPreferences(preferences: Partial<PlayerPreferences>): void;
  onSubtitleToggle(): void;
  onSubtitleOffset(offset: number): void;
  onPlaybackError(message: string): void;
}

function PlayerControls({
  hasCaptions,
  metrics,
  onPreferences,
}: {
  hasCaptions: boolean;
  metrics: TorrentMetrics;
  onPreferences(preferences: Partial<PlayerPreferences>): void;
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

  const cycleSpeed = () => {
    const rates = [0.75, 1, 1.25, 1.5, 2];
    const index = rates.indexOf(playbackRate);
    const next = rates[(index + 1) % rates.length];
    remote.changePlaybackRate(next);
    onPreferences({ playbackRate: next });
  };

  return (
    <Controls.Root className="player-controls">
      <div className="timeline-row">
        <TimeSlider.Root className="time-slider" aria-label="Seek through media">
          <TimeSlider.Track className="slider-track">
            <TimeSlider.Progress className="slider-progress" />
            <TimeSlider.TrackFill className="slider-fill" />
          </TimeSlider.Track>
          <TimeSlider.Thumb className="slider-thumb" />
          <TimeSlider.Preview className="time-preview">
            <TimeSlider.Value />
          </TimeSlider.Preview>
        </TimeSlider.Root>
      </div>

      <div className="transport-row">
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
            <span aria-hidden="true">/</span>
            <Time type="duration" />
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
            {formatSpeed(metrics.downloadSpeed)}
          </span>

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
      </div>
    </Controls.Root>
  );
}

function PlayerStatus({
  buffering,
  metrics,
}: {
  buffering: boolean;
  metrics: TorrentMetrics;
}) {
  const canPlay = useMediaState("canPlay");
  const paused = useMediaState("paused");

  if (canPlay && !buffering) return null;

  return (
    <div className="player-status-overlay" role="status" aria-live="polite">
      <div className="pixel-loader" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <span className="eyebrow">
        {!canPlay ? "PREPARING STREAM" : "BUFFERING PIECES"}
      </span>
      <strong>
        {metrics.peers
          ? "Waiting for the next pieces"
          : "Searching the swarm"}
      </strong>
      <p>
        {metrics.peers} peer{metrics.peers === 1 ? "" : "s"} ·{" "}
        {formatSpeed(metrics.downloadSpeed)}
        {paused && canPlay ? " · Playback paused" : ""}
      </p>
    </div>
  );
}

export function RetroPlayer({
  stream,
  meta,
  metrics,
  subtitle,
  subtitleOffset,
  preferences,
  onPreferences,
  onSubtitleToggle,
  onSubtitleOffset,
  onPlaybackError,
}: RetroPlayerProps) {
  const playerRef = useRef<MediaPlayerInstance>(null);
  const [buffering, setBuffering] = useState(true);
  const [resumeRecord, setResumeRecord] = useState<ResumeRecord | null>(null);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const lastSaveAt = useRef(0);

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
    const record = await getResumeRecord(meta.infoHash, stream.file.path);
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

  const handleTimeUpdate = useCallback(
    (detail: { currentTime: number }) => {
      const now = Date.now();
      if (now - lastSaveAt.current < 5000 || detail.currentTime < 1) return;
      lastSaveAt.current = now;
      const player = playerRef.current;
      void saveResumeRecord({
        id: meta.infoHash + ":" + stream.file.path,
        infoHash: meta.infoHash,
        torrentName: meta.name,
        filePath: stream.file.path,
        fileName: stream.file.name,
        position: detail.currentTime,
        duration: Number.isFinite(player?.duration) ? player?.duration || 0 : 0,
        subtitleOffset,
        lastOpenedAt: now,
      });
    },
    [meta.infoHash, meta.name, stream.file, subtitleOffset],
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
        src={{ src: stream.url, type: stream.mime as "video/mp4" }}
        viewType={stream.file.category === "audio" ? "audio" : "video"}
        streamType="on-demand"
        preload="metadata"
        playsInline
        keyDisabled
        onLoadedMetadata={() => void loadResume()}
        onCanPlay={() => setBuffering(false)}
        onPlaying={() => setBuffering(false)}
        onWaiting={() => setBuffering(true)}
        onStalled={() => setBuffering(true)}
        onTimeUpdate={handleTimeUpdate}
        onVolumeChange={(detail) =>
          onPreferences({ volume: detail.volume, muted: detail.muted })
        }
        onRateChange={(rate) => onPreferences({ playbackRate: rate })}
        onError={(detail) =>
          onPlaybackError(
            detail.message ||
              "Your browser could not decode this file. Try another media file.",
          )
        }
      >
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
        <PlayerStatus buffering={buffering} metrics={metrics} />

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
          metrics={metrics}
          onPreferences={onPreferences}
        />
      </MediaPlayer>

      <div className="player-status-strip">
        <span className="online-label">
          <i aria-hidden="true" />
          P2P {metrics.peers ? "ONLINE" : "SEARCHING"}
        </span>
        <span>{metrics.peers} peers</span>
        <span>{formatSpeed(metrics.downloadSpeed)}</span>
        <span className="status-strip-note">WebRTC browser stream</span>
      </div>
    </div>
  );
}
