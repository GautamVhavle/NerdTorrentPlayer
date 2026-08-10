"use client";

import { create } from "zustand";
import { getBestPlayableFile } from "../torrent/torrent-files";
import type { ResumeRecord } from "../lib/history";
import type { SubtitleTrackModel } from "../subtitles/subtitle-parser";
import type {
  StreamSource,
  TorrentFileView,
  TorrentMeta,
  TorrentMetrics,
  TorrentPhase,
} from "../torrent/torrent-types";

export type AppView = "landing" | "files" | "watch";
export type InspectorPanel = "files" | "captions" | "stream";

export interface PlayerPreferences {
  volume: number;
  muted: boolean;
  playbackRate: number;
}

interface TorrentStore {
  view: AppView;
  phase: TorrentPhase;
  phaseMessage: string;
  meta: TorrentMeta | null;
  files: TorrentFileView[];
  selectedFilePath: string | null;
  stream: StreamSource | null;
  metrics: TorrentMetrics;
  error: string | null;
  peerNotice: string | null;
  inspectorPanel: InspectorPanel;
  mobilePanel: InspectorPanel | null;
  helpOpen: boolean;
  whyOpen: boolean;
  subtitles: SubtitleTrackModel[];
  activeSubtitleId: string | null;
  subtitleOffset: number;
  subtitleError: string | null;
  history: ResumeRecord[];
  preferences: PlayerPreferences;
  setPhase(phase: TorrentPhase, message: string): void;
  setReady(meta: TorrentMeta, files: TorrentFileView[]): void;
  setMetrics(metrics: TorrentMetrics): void;
  setError(error: string | null): void;
  setPeerNotice(message: string | null): void;
  selectFile(path: string): void;
  beginWatch(stream: StreamSource): void;
  showFiles(): void;
  setInspectorPanel(panel: InspectorPanel): void;
  setMobilePanel(panel: InspectorPanel | null): void;
  setHelpOpen(open: boolean): void;
  setWhyOpen(open: boolean): void;
  addSubtitle(track: SubtitleTrackModel): void;
  setSubtitles(tracks: SubtitleTrackModel[]): void;
  setActiveSubtitle(id: string | null): void;
  setSubtitleOffset(offset: number): void;
  setSubtitleError(error: string | null): void;
  setHistory(history: ResumeRecord[]): void;
  setPreferences(preferences: Partial<PlayerPreferences>): void;
  resetSession(): void;
}

const EMPTY_METRICS: TorrentMetrics = {
  peers: 0,
  downloadSpeed: 0,
  uploadSpeed: 0,
  progress: 0,
  downloaded: 0,
  uploaded: 0,
};

export const useTorrentStore = create<TorrentStore>((set) => ({
  view: "landing",
  phase: "idle",
  phaseMessage: "Ready.",
  meta: null,
  files: [],
  selectedFilePath: null,
  stream: null,
  metrics: EMPTY_METRICS,
  error: null,
  peerNotice: null,
  inspectorPanel: "files",
  mobilePanel: null,
  helpOpen: false,
  whyOpen: false,
  subtitles: [],
  activeSubtitleId: null,
  subtitleOffset: 0,
  subtitleError: null,
  history: [],
  preferences: {
    volume: 0.85,
    muted: false,
    playbackRate: 1,
  },
  setPhase: (phase, message) => set({ phase, phaseMessage: message }),
  setReady: (meta, files) => {
    const best = getBestPlayableFile(files);
    set({
      view: "files",
      phase: "ready",
      phaseMessage: "Torrent metadata received.",
      meta,
      files,
      selectedFilePath: best?.path || null,
      error: null,
    });
  },
  setMetrics: (metrics) => set({ metrics }),
  setError: (error) => set({ error }),
  setPeerNotice: (peerNotice) => set({ peerNotice }),
  selectFile: (selectedFilePath) => set({ selectedFilePath }),
  beginWatch: (stream) =>
    set({
      view: "watch",
      phase: "streaming",
      phaseMessage: "Stream prepared.",
      stream,
      inspectorPanel: "files",
      mobilePanel: null,
      error: null,
    }),
  showFiles: () => set({ view: "files", mobilePanel: null }),
  setInspectorPanel: (inspectorPanel) => set({ inspectorPanel }),
  setMobilePanel: (mobilePanel) => set({ mobilePanel }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setWhyOpen: (whyOpen) => set({ whyOpen }),
  addSubtitle: (track) =>
    set((state) => ({
      subtitles: [...state.subtitles.filter((item) => item.id !== track.id), track],
      activeSubtitleId: track.id,
      subtitleError: null,
    })),
  setSubtitles: (subtitles) =>
    set({
      subtitles,
      activeSubtitleId: subtitles[0]?.id || null,
      subtitleError: null,
    }),
  setActiveSubtitle: (activeSubtitleId) => set({ activeSubtitleId }),
  setSubtitleOffset: (subtitleOffset) => set({ subtitleOffset }),
  setSubtitleError: (subtitleError) => set({ subtitleError }),
  setHistory: (history) => set({ history }),
  setPreferences: (preferences) =>
    set((state) => ({
      preferences: { ...state.preferences, ...preferences },
    })),
  resetSession: () =>
    set({
      view: "landing",
      phase: "idle",
      phaseMessage: "Ready.",
      meta: null,
      files: [],
      selectedFilePath: null,
      stream: null,
      metrics: EMPTY_METRICS,
      error: null,
      peerNotice: null,
      inspectorPanel: "files",
      mobilePanel: null,
      subtitles: [],
      activeSubtitleId: null,
      subtitleOffset: 0,
      subtitleError: null,
    }),
}));

