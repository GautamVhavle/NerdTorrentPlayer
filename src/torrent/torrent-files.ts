import type {
  Compatibility,
  FileCategory,
  RuntimeTorrentFile,
  TorrentFileView,
} from "./torrent-types";

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mkv",
  "webm",
  "mov",
  "m4v",
  "avi",
  "ogv",
]);

const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "m4a",
  "flac",
  "aac",
  "ogg",
  "oga",
  "wav",
  "opus",
]);

const SUBTITLE_EXTENSIONS = new Set(["srt", "vtt", "ass", "ssa"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif"]);

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  opus: "audio/ogg",
  srt: "application/x-subrip",
  vtt: "text/vtt",
  ass: "text/x-ssa",
  ssa: "text/x-ssa",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

const EXTENSION_SCORE: Record<string, number> = {
  mp4: 100,
  webm: 92,
  m4v: 88,
  mov: 68,
  mkv: 60,
  ogv: 55,
  avi: 32,
  m4a: 90,
  mp3: 86,
  ogg: 70,
  opus: 66,
  wav: 52,
  flac: 48,
  aac: 44,
};

export function getExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

export function getCategory(extension: string): FileCategory {
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (SUBTITLE_EXTENSIONS.has(extension)) return "subtitle";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  return "other";
}

export function getMime(extension: string, reported?: string): string {
  return reported || MIME_BY_EXTENSION[extension] || "application/octet-stream";
}

export function getCompatibility(
  extension: string,
  category: FileCategory,
): Compatibility {
  if (["mp4", "m4v", "webm", "mp3", "m4a", "ogg", "oga"].includes(extension)) {
    return "likely";
  }

  if (
    category === "video" ||
    category === "audio" ||
    category === "subtitle"
  ) {
    return "maybe";
  }

  return "unlikely";
}

function rankFile(
  file: RuntimeTorrentFile,
  category: FileCategory,
  extension: string,
): number {
  const normalized = file.name.toLowerCase();
  const categoryScore =
    category === "video" ? 1000 : category === "audio" ? 620 : 0;
  const extensionScore = EXTENSION_SCORE[extension] || 0;
  const sizeScore = Math.min(260, Math.log10(Math.max(file.length, 1)) * 30);
  const isExtra =
    /(^|[._\-\s])(sample|trailer|preview|extras?|featurette)([._\-\s]|$)/i.test(
      normalized,
    );
  const penalty = isExtra ? 700 : 0;

  return categoryScore + extensionScore + sizeScore - penalty;
}

export function mapTorrentFile(file: RuntimeTorrentFile): TorrentFileView {
  const extension = getExtension(file.name);
  const category = getCategory(extension);

  return {
    id: file.path,
    name: file.name,
    path: file.path,
    length: file.length,
    extension,
    category,
    mime: getMime(extension, file.type),
    compatibility: getCompatibility(extension, category),
    rank: rankFile(file, category, extension),
    progress: file.progress || 0,
  };
}

export function mapAndSortFiles(
  files: RuntimeTorrentFile[],
): TorrentFileView[] {
  return files
    .map(mapTorrentFile)
    .sort((a, b) => b.rank - a.rank || b.length - a.length);
}

export function getBestPlayableFile(
  files: TorrentFileView[],
): TorrentFileView | null {
  return (
    files.find((file) => file.category === "video") ||
    files.find((file) => file.category === "audio") ||
    null
  );
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** index;
  return value.toFixed(index === 0 ? 0 : decimals) + " " + units[index];
}

export function formatSpeed(bytes: number): string {
  return formatBytes(bytes) + "/s";
}

export function getLanguageFromFilename(name: string): {
  code: string;
  label: string;
} {
  const normalized = name.toLowerCase();
  const languages: Array<[string, string, RegExp]> = [
    ["en", "English", /(?:^|[._\-\s])(en|eng|english)(?:[._\-\s]|$)/],
    ["hi", "Hindi", /(?:^|[._\-\s])(hi|hin|hindi)(?:[._\-\s]|$)/],
    ["es", "Spanish", /(?:^|[._\-\s])(es|spa|spanish)(?:[._\-\s]|$)/],
    ["de", "German", /(?:^|[._\-\s])(de|deu|ger|german)(?:[._\-\s]|$)/],
    ["fr", "French", /(?:^|[._\-\s])(fr|fra|fre|french)(?:[._\-\s]|$)/],
    ["ja", "Japanese", /(?:^|[._\-\s])(ja|jpn|japanese)(?:[._\-\s]|$)/],
    ["ko", "Korean", /(?:^|[._\-\s])(ko|kor|korean)(?:[._\-\s]|$)/],
    ["zh", "Chinese", /(?:^|[._\-\s])(zh|zho|chi|chinese)(?:[._\-\s]|$)/],
  ];

  const match = languages.find(([, , pattern]) => pattern.test(normalized));
  return match
    ? { code: match[0], label: match[1] }
    : { code: "und", label: "Subtitle" };
}

