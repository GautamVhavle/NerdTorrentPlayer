export type SubtitleFormat = "srt" | "vtt" | "ass" | "ssa";

export interface SubtitleTrackModel {
  id: string;
  name: string;
  language: string;
  format: SubtitleFormat;
  content: string;
  source: "torrent" | "upload";
  path?: string;
}

function parseTimestamp(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) return null;

  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function formatTimestamp(value: number): string {
  const milliseconds = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return (
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0") +
    "." +
    String(ms).padStart(3, "0")
  );
}

function shiftTimelineLine(line: string, offsetSeconds: number): string {
  const match = line.match(
    /^(\s*)(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})\s+-->\s+(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})(.*)$/,
  );
  if (!match) return line;
  const start = parseTimestamp(match[2]);
  const end = parseTimestamp(match[3]);
  if (start === null || end === null) return line;
  return (
    match[1] +
    formatTimestamp(start + offsetSeconds) +
    " --> " +
    formatTimestamp(end + offsetSeconds) +
    match[4]
  );
}

function srtOrVttToVtt(
  content: string,
  format: "srt" | "vtt",
  offsetSeconds: number,
): string {
  const normalized = content.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const body =
    format === "vtt"
      ? normalized.replace(/^WEBVTT[^\n]*\n*/i, "")
      : normalized;
  const shifted = body
    .split("\n")
    .map((line) => shiftTimelineLine(line, offsetSeconds))
    .join("\n")
    .trim();

  if (!shifted.includes("-->")) {
    throw new Error("No readable subtitle cues were found.");
  }

  return "WEBVTT\n\n" + shifted + "\n";
}

function assToVtt(content: string, offsetSeconds: number): string {
  const cues: string[] = [];
  const lines = content.replace(/\r\n?/g, "\n").split("\n");

  for (const line of lines) {
    if (!/^Dialogue:/i.test(line)) continue;
    const payload = line.slice(line.indexOf(":") + 1).trim();
    const fields = payload.split(",");
    if (fields.length < 3) continue;

    const start = parseTimestamp(fields[1]);
    const end = parseTimestamp(fields[2]);
    if (start === null || end === null) continue;
    const text = fields
      .slice(9)
      .join(",")
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\N/gi, "\n")
      .replace(/\\h/gi, " ")
      .trim();
    if (!text) continue;

    cues.push(
      String(cues.length + 1) +
        "\n" +
        formatTimestamp(start + offsetSeconds) +
        " --> " +
        formatTimestamp(end + offsetSeconds) +
        "\n" +
        text,
    );
  }

  if (!cues.length) {
    throw new Error("No readable SSA/ASS dialogue cues were found.");
  }

  return "WEBVTT\n\n" + cues.join("\n\n") + "\n";
}

export function subtitleToVtt(
  content: string,
  format: SubtitleFormat,
  offsetSeconds = 0,
): string {
  if (format === "ass" || format === "ssa") {
    return assToVtt(content, offsetSeconds);
  }
  return srtOrVttToVtt(content, format, offsetSeconds);
}

export function inferSubtitleFormat(name: string): SubtitleFormat | null {
  const extension = name.split(".").pop()?.toLowerCase();
  if (
    extension === "srt" ||
    extension === "vtt" ||
    extension === "ass" ||
    extension === "ssa"
  ) {
    return extension;
  }
  return null;
}

export async function subtitleFromUpload(
  file: File,
): Promise<SubtitleTrackModel> {
  const format = inferSubtitleFormat(file.name);
  if (!format) {
    throw new Error("Use an SRT, VTT, ASS, or SSA subtitle file.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Subtitle files must be smaller than 8 MB.");
  }

  const content = await file.text();
  subtitleToVtt(content, format);
  return {
    id: "upload-" + Date.now() + "-" + file.name,
    name: file.name.replace(/\.[^.]+$/, ""),
    language: "und",
    format,
    content,
    source: "upload",
  };
}

