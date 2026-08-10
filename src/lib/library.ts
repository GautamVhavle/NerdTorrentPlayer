/**
 * The torrent library is intentionally local-only. Raw magnet URIs and
 * .torrent bytes never enter Zustand, localStorage, analytics, or a network
 * request; callers must explicitly opt in before a source is persisted.
 */

export const LIBRARY_LIMITS = Object.freeze({
  maxEntries: 100,
  maxMagnetLength: 16_384,
  maxTorrentBytes: 5 * 1024 * 1024,
  maxImportBytes: 75 * 1024 * 1024,
});

export type LibrarySourceKind = "magnet" | "torrent";

export type LibrarySource =
  | { kind: "magnet"; value: string }
  | { kind: "torrent"; value: Uint8Array; fileName: string };

export interface LibraryRecord {
  id: string;
  infoHash: string;
  title: string;
  sourceKind: LibrarySourceKind;
  torrentFileName: string | null;
  torrentByteLength: number;
  totalBytes: number;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  pinned: boolean;
  openCount: number;
  selectedFilePath: string | null;
  position: number;
  duration: number;
  progress: number;
}

export interface SaveLibraryRecordInput {
  /** Explicit acknowledgement that the private source may be kept on-device. */
  consent: true;
  infoHash: string;
  title: string;
  source: LibrarySource;
  totalBytes?: number;
  pinned?: boolean;
  selectedFilePath?: string | null;
  position?: number;
  duration?: number;
  progress?: number;
}

export type LibraryRecordPatch = Partial<
  Pick<
    LibraryRecord,
    | "title"
    | "totalBytes"
    | "pinned"
    | "selectedFilePath"
    | "position"
    | "duration"
    | "progress"
  >
>;

export interface LibraryPlaybackUpdate {
  selectedFilePath?: string | null;
  position?: number;
  duration?: number;
  progress?: number;
}

export interface LibraryImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface LibraryStorageStatus {
  backend: "indexeddb" | "memory";
  /** Whether the browser has granted durable storage, not merely IDB access. */
  persisted: boolean;
  recordCount: number;
  sourceBytes: number;
  usageBytes: number | null;
  quotaBytes: number | null;
}

interface StoredMagnetSource {
  kind: "magnet";
  value: string;
}

interface StoredTorrentSource {
  kind: "torrent";
  value: ArrayBuffer;
  fileName: string;
}

type StoredLibrarySource = StoredMagnetSource | StoredTorrentSource;

interface StoredLibraryRecord extends LibraryRecord {
  schemaVersion: 1;
  source: StoredLibrarySource;
}

interface SerializedLibrarySource {
  kind: LibrarySourceKind;
  value: string;
  fileName?: string;
  encoding: "uri" | "base64";
}

interface SerializedLibraryRecord extends LibraryRecord {
  source: SerializedLibrarySource | null;
}

interface LibraryExportEnvelope {
  kind: "nerd-torrent-player-library";
  version: 1;
  exportedAt: number;
  includesPrivateSources: boolean;
  records: SerializedLibraryRecord[];
}

export const LOCAL_DATABASE_NAME = "torrent-exe";
export const LOCAL_DATABASE_VERSION = 2;
export const RESUME_STORE_NAME = "resume";
export const LIBRARY_STORE_NAME = "library";

const memoryLibrary = new Map<string, StoredLibraryRecord>();
const deletedLibraryIds = new Set<string>();
let databasePromise: Promise<IDBDatabase | null> | null = null;

function createSchema(database: IDBDatabase, transaction: IDBTransaction | null) {
  let resumeStore: IDBObjectStore;
  if (!database.objectStoreNames.contains(RESUME_STORE_NAME)) {
    resumeStore = database.createObjectStore(RESUME_STORE_NAME, {
      keyPath: "id",
    });
  } else if (transaction) {
    resumeStore = transaction.objectStore(RESUME_STORE_NAME);
  } else {
    resumeStore = database
      .transaction(RESUME_STORE_NAME, "readonly")
      .objectStore(RESUME_STORE_NAME);
  }
  if (!resumeStore.indexNames.contains("lastOpenedAt")) {
    resumeStore.createIndex("lastOpenedAt", "lastOpenedAt");
  }

  let libraryStore: IDBObjectStore;
  if (!database.objectStoreNames.contains(LIBRARY_STORE_NAME)) {
    libraryStore = database.createObjectStore(LIBRARY_STORE_NAME, {
      keyPath: "id",
    });
  } else if (transaction) {
    libraryStore = transaction.objectStore(LIBRARY_STORE_NAME);
  } else {
    libraryStore = database
      .transaction(LIBRARY_STORE_NAME, "readonly")
      .objectStore(LIBRARY_STORE_NAME);
  }
  if (!libraryStore.indexNames.contains("lastOpenedAt")) {
    libraryStore.createIndex("lastOpenedAt", "lastOpenedAt");
  }
  if (!libraryStore.indexNames.contains("pinned")) {
    libraryStore.createIndex("pinned", "pinned");
  }
  if (!libraryStore.indexNames.contains("infoHash")) {
    libraryStore.createIndex("infoHash", "infoHash", { unique: true });
  }
}

/** Shared by history.ts so opening either feature upgrades the v1 database. */
export function openLocalDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve) => {
    let settled = false;
    let request: IDBOpenDBRequest;

    const finish = (database: IDBDatabase | null) => {
      if (settled) {
        database?.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(database);
    };

    const timeout = setTimeout(() => finish(null), 2_000);

    try {
      request = indexedDB.open(LOCAL_DATABASE_NAME, LOCAL_DATABASE_VERSION);
    } catch {
      finish(null);
      return;
    }

    request.onupgradeneeded = () => {
      try {
        createSchema(request.result, request.transaction);
      } catch {
        request.transaction?.abort();
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      finish(database);
    };
    request.onerror = () => finish(null);
    request.onblocked = () => {
      // The timeout above switches this tab to its session-only fallback.
    };
  });

  return databasePromise;
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export function transactionFinished(transaction: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
  });
}

function normalizeInfoHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64}|[a-z2-7]{32})$/i.test(normalized)) {
    throw new Error("A valid BitTorrent info hash is required.");
  }
  return normalized;
}

function cleanText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const cleaned = [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .trim();
  return cleaned.slice(0, maxLength) || fallback;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: unknown, fallback = 0): number {
  return Math.max(0, finiteNumber(value, fallback));
}

function normalizedProgress(value: unknown, position = 0, duration = 0): number {
  const derived = duration > 0 ? position / duration : 0;
  return Math.min(1, Math.max(0, finiteNumber(value, derived)));
}

function copySource(source: LibrarySource): StoredLibrarySource {
  if (source.kind === "magnet") {
    const value = source.value.trim();
    if (!value || value.length > LIBRARY_LIMITS.maxMagnetLength) {
      throw new Error("The magnet URI is empty or exceeds the local safety limit.");
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("The magnet URI is invalid.");
    }
    const exactTopics = parsed.searchParams.getAll("xt");
    if (
      parsed.protocol !== "magnet:" ||
      !exactTopics.some((topic) => /^urn:bt(?:ih|mh):/i.test(topic))
    ) {
      throw new Error("The magnet URI does not contain a BitTorrent topic.");
    }
    return { kind: "magnet", value };
  }

  const bytes = new Uint8Array(source.value).slice();
  if (!bytes.byteLength || bytes.byteLength > LIBRARY_LIMITS.maxTorrentBytes) {
    throw new Error("The .torrent file is empty or exceeds the 5 MiB safety limit.");
  }
  return {
    kind: "torrent",
    value: bytes.buffer,
    fileName: cleanText(source.fileName, "saved.torrent", 255),
  };
}

function cloneStored(record: StoredLibraryRecord): StoredLibraryRecord {
  return {
    ...record,
    source:
      record.source.kind === "magnet"
        ? { ...record.source }
        : {
            ...record.source,
            value: record.source.value.slice(0),
          },
  };
}

function publicRecord(record: StoredLibraryRecord): LibraryRecord {
  return {
    id: record.id,
    infoHash: record.infoHash,
    title: record.title,
    sourceKind: record.sourceKind,
    torrentFileName: record.torrentFileName,
    torrentByteLength: record.torrentByteLength,
    totalBytes: record.totalBytes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastOpenedAt: record.lastOpenedAt,
    pinned: record.pinned,
    openCount: record.openCount,
    selectedFilePath: record.selectedFilePath,
    position: record.position,
    duration: record.duration,
    progress: record.progress,
  };
}

function normalizeStoredRecord(record: StoredLibraryRecord): StoredLibraryRecord | null {
  try {
    const infoHash = normalizeInfoHash(record.infoHash || record.id);
    const position = positiveNumber(record.position);
    const duration = positiveNumber(record.duration);
    const now = Date.now();
    const source =
      record.source.kind === "magnet"
        ? copySource({ kind: "magnet", value: record.source.value })
        : copySource({
            kind: "torrent",
            value: new Uint8Array(record.source.value),
            fileName: record.source.fileName,
          });
    return {
      id: infoHash,
      infoHash,
      title: cleanText(record.title, "Untitled torrent", 240),
      sourceKind: source.kind,
      torrentFileName: source.kind === "torrent" ? source.fileName : null,
      torrentByteLength: source.kind === "torrent" ? source.value.byteLength : 0,
      totalBytes: positiveNumber(record.totalBytes),
      createdAt: positiveNumber(record.createdAt, now) || now,
      updatedAt: positiveNumber(record.updatedAt, now) || now,
      lastOpenedAt: positiveNumber(record.lastOpenedAt, now) || now,
      pinned: Boolean(record.pinned),
      openCount: Math.floor(positiveNumber(record.openCount)),
      selectedFilePath:
        record.selectedFilePath === null
          ? null
          : cleanText(record.selectedFilePath, "", 2_048) || null,
      position,
      duration,
      progress: normalizedProgress(record.progress, position, duration),
      schemaVersion: 1,
      source,
    };
  } catch {
    return null;
  }
}

async function readStoredRecords(): Promise<StoredLibraryRecord[]> {
  const database = await openLocalDatabase();
  let persisted: StoredLibraryRecord[] = [];

  if (database && database.objectStoreNames.contains(LIBRARY_STORE_NAME)) {
    try {
      const transaction = database.transaction(LIBRARY_STORE_NAME, "readonly");
      const result = await requestResult<StoredLibraryRecord[]>(
        transaction.objectStore(LIBRARY_STORE_NAME).getAll(),
      );
      persisted = result || [];
    } catch {
      persisted = [];
    }
  }

  const merged = new Map<string, StoredLibraryRecord>();
  for (const candidate of persisted) {
    const record = normalizeStoredRecord(candidate);
    if (record && !deletedLibraryIds.has(record.id)) merged.set(record.id, record);
  }
  for (const record of memoryLibrary.values()) {
    if (!deletedLibraryIds.has(record.id)) merged.set(record.id, cloneStored(record));
  }
  return [...merged.values()];
}

async function readStoredRecord(id: string): Promise<StoredLibraryRecord | null> {
  const normalizedId = normalizeInfoHash(id);
  if (deletedLibraryIds.has(normalizedId)) return null;
  const memoryRecord = memoryLibrary.get(normalizedId);
  if (memoryRecord) return cloneStored(memoryRecord);

  const database = await openLocalDatabase();
  if (!database || !database.objectStoreNames.contains(LIBRARY_STORE_NAME)) return null;
  try {
    const transaction = database.transaction(LIBRARY_STORE_NAME, "readonly");
    const record = await requestResult<StoredLibraryRecord>(
      transaction.objectStore(LIBRARY_STORE_NAME).get(normalizedId),
    );
    return record ? normalizeStoredRecord(record) : null;
  } catch {
    return null;
  }
}

async function putStoredRecord(record: StoredLibraryRecord): Promise<void> {
  const safeRecord = cloneStored(record);
  const database = await openLocalDatabase();
  let persisted = false;

  if (database && database.objectStoreNames.contains(LIBRARY_STORE_NAME)) {
    try {
      const transaction = database.transaction(LIBRARY_STORE_NAME, "readwrite");
      transaction.objectStore(LIBRARY_STORE_NAME).put(safeRecord);
      persisted = await transactionFinished(transaction);
    } catch {
      persisted = false;
    }
  }

  deletedLibraryIds.delete(record.id);
  if (persisted) memoryLibrary.delete(record.id);
  else memoryLibrary.set(record.id, safeRecord);
}

async function deleteStoredRecord(id: string): Promise<void> {
  const normalizedId = normalizeInfoHash(id);
  memoryLibrary.delete(normalizedId);
  const database = await openLocalDatabase();
  let persisted = false;
  if (database && database.objectStoreNames.contains(LIBRARY_STORE_NAME)) {
    try {
      const transaction = database.transaction(LIBRARY_STORE_NAME, "readwrite");
      transaction.objectStore(LIBRARY_STORE_NAME).delete(normalizedId);
      persisted = await transactionFinished(transaction);
    } catch {
      persisted = false;
    }
  }
  if (persisted) deletedLibraryIds.delete(normalizedId);
  else deletedLibraryIds.add(normalizedId);
}

async function ensureCapacityFor(id: string): Promise<void> {
  const records = await readStoredRecords();
  if (records.some((record) => record.id === id)) return;
  if (records.length < LIBRARY_LIMITS.maxEntries) return;

  const evictionCandidate = records
    .filter((record) => !record.pinned)
    .sort((a, b) => a.lastOpenedAt - b.lastOpenedAt)[0];
  if (!evictionCandidate) {
    throw new Error(
      `The library is full (${LIBRARY_LIMITS.maxEntries} pinned torrents). Unpin or remove one first.`,
    );
  }
  await deleteStoredRecord(evictionCandidate.id);
}

export async function listLibraryRecords(): Promise<LibraryRecord[]> {
  const records = await readStoredRecords();
  return records
    .map(publicRecord)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.lastOpenedAt - a.lastOpenedAt ||
        a.title.localeCompare(b.title),
    );
}

export async function getLibraryRecord(id: string): Promise<LibraryRecord | null> {
  const record = await readStoredRecord(id);
  return record ? publicRecord(record) : null;
}

/** Raw private source access is separate so normal library rendering cannot leak it. */
export async function getLibrarySource(id: string): Promise<LibrarySource | null> {
  const record = await readStoredRecord(id);
  if (!record) return null;
  return record.source.kind === "magnet"
    ? { kind: "magnet", value: record.source.value }
    : {
        kind: "torrent",
        value: new Uint8Array(record.source.value.slice(0)),
        fileName: record.source.fileName,
      };
}

export async function saveLibraryRecord(
  input: SaveLibraryRecordInput,
): Promise<LibraryRecord> {
  if (input.consent !== true) {
    throw new Error("Saving a private torrent source requires explicit consent.");
  }
  const infoHash = normalizeInfoHash(input.infoHash);
  const source = copySource(input.source);
  await ensureCapacityFor(infoHash);

  const now = Date.now();
  const existing = await readStoredRecord(infoHash);
  const position = positiveNumber(input.position, existing?.position);
  const duration = positiveNumber(input.duration, existing?.duration);
  const record: StoredLibraryRecord = {
    id: infoHash,
    infoHash,
    title: cleanText(input.title, existing?.title || "Untitled torrent", 240),
    sourceKind: source.kind,
    torrentFileName: source.kind === "torrent" ? source.fileName : null,
    torrentByteLength: source.kind === "torrent" ? source.value.byteLength : 0,
    totalBytes: positiveNumber(input.totalBytes, existing?.totalBytes),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastOpenedAt: existing?.lastOpenedAt || now,
    pinned: input.pinned ?? existing?.pinned ?? false,
    openCount: existing?.openCount || 0,
    selectedFilePath:
      input.selectedFilePath === undefined
        ? existing?.selectedFilePath || null
        : input.selectedFilePath === null
          ? null
          : cleanText(input.selectedFilePath, "", 2_048) || null,
    position,
    duration,
    progress: normalizedProgress(input.progress, position, duration),
    schemaVersion: 1,
    source,
  };
  await putStoredRecord(record);
  return publicRecord(record);
}

export async function updateLibraryRecord(
  id: string,
  patch: LibraryRecordPatch,
): Promise<LibraryRecord | null> {
  const record = await readStoredRecord(id);
  if (!record) return null;
  const position = positiveNumber(patch.position, record.position);
  const duration = positiveNumber(patch.duration, record.duration);
  const next: StoredLibraryRecord = {
    ...record,
    title:
      patch.title === undefined
        ? record.title
        : cleanText(patch.title, record.title, 240),
    totalBytes: positiveNumber(patch.totalBytes, record.totalBytes),
    pinned: patch.pinned ?? record.pinned,
    selectedFilePath:
      patch.selectedFilePath === undefined
        ? record.selectedFilePath
        : patch.selectedFilePath === null
          ? null
          : cleanText(patch.selectedFilePath, "", 2_048) || null,
    position,
    duration,
    progress: normalizedProgress(patch.progress, position, duration),
    updatedAt: Date.now(),
  };
  await putStoredRecord(next);
  return publicRecord(next);
}

export async function touchLibraryRecord(
  id: string,
  playback: LibraryPlaybackUpdate = {},
): Promise<LibraryRecord | null> {
  const record = await readStoredRecord(id);
  if (!record) return null;
  const position = positiveNumber(playback.position, record.position);
  const duration = positiveNumber(playback.duration, record.duration);
  const now = Date.now();
  const next: StoredLibraryRecord = {
    ...record,
    selectedFilePath:
      playback.selectedFilePath === undefined
        ? record.selectedFilePath
        : playback.selectedFilePath === null
          ? null
          : cleanText(playback.selectedFilePath, "", 2_048) || null,
    position,
    duration,
    progress: normalizedProgress(playback.progress, position, duration),
    lastOpenedAt: now,
    updatedAt: now,
    openCount: record.openCount + 1,
  };
  await putStoredRecord(next);
  return publicRecord(next);
}

export async function deleteLibraryRecord(id: string): Promise<void> {
  await deleteStoredRecord(id);
}

export async function clearLibrary(): Promise<void> {
  const knownRecords = await readStoredRecords();
  memoryLibrary.clear();
  const database = await openLocalDatabase();
  let persisted = false;
  if (database && database.objectStoreNames.contains(LIBRARY_STORE_NAME)) {
    try {
      const transaction = database.transaction(LIBRARY_STORE_NAME, "readwrite");
      transaction.objectStore(LIBRARY_STORE_NAME).clear();
      persisted = await transactionFinished(transaction);
    } catch {
      persisted = false;
    }
  }
  if (persisted) deletedLibraryIds.clear();
  else knownRecords.forEach((record) => deletedLibraryIds.add(record.id));
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Sources are excluded by default because an export may leave the device. */
export async function exportLibrary(
  options: { includeSources?: boolean } = {},
): Promise<string> {
  const includeSources = options.includeSources === true;
  const records = await readStoredRecords();
  const envelope: LibraryExportEnvelope = {
    kind: "nerd-torrent-player-library",
    version: 1,
    exportedAt: Date.now(),
    includesPrivateSources: includeSources,
    records: records.map((record) => ({
      ...publicRecord(record),
      source: !includeSources
        ? null
        : record.source.kind === "magnet"
          ? {
              kind: "magnet",
              value: record.source.value,
              encoding: "uri",
            }
          : {
              kind: "torrent",
              value: bytesToBase64(record.source.value),
              fileName: record.source.fileName,
              encoding: "base64",
            },
    })),
  };
  return JSON.stringify(envelope, null, 2);
}

export async function importLibrary(
  serialized: string,
  options: {
    confirmSourceImport: true;
    mode?: "merge" | "replace";
  },
): Promise<LibraryImportResult> {
  if (options?.confirmSourceImport !== true) {
    throw new Error("Importing private torrent sources requires confirmation.");
  }
  if (serialized.length > LIBRARY_LIMITS.maxImportBytes) {
    throw new Error("The library backup exceeds the 75 MiB import safety limit.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  const envelope = parsed as Partial<LibraryExportEnvelope>;
  if (
    envelope.kind !== "nerd-torrent-player-library" ||
    envelope.version !== 1 ||
    !Array.isArray(envelope.records)
  ) {
    throw new Error("This is not a supported NerdTorrentPlayer library backup.");
  }

  if (options.mode === "replace") await clearLibrary();

  const result: LibraryImportResult = { imported: 0, skipped: 0, errors: [] };
  for (const [index, candidate] of envelope.records
    .slice(0, LIBRARY_LIMITS.maxEntries)
    .entries()) {
    try {
      const source = candidate.source;
      if (!source) throw new Error("backup omits its private source");
      let librarySource: LibrarySource;
      if (source.kind === "magnet" && source.encoding === "uri") {
        librarySource = { kind: "magnet", value: source.value };
      } else if (source.kind === "torrent" && source.encoding === "base64") {
        const bytes = base64ToBytes(source.value);
        librarySource = {
          kind: "torrent",
          value: bytes,
          fileName: source.fileName || "imported.torrent",
        };
      } else {
        throw new Error("source encoding is unsupported");
      }

      const saved = await saveLibraryRecord({
        consent: true,
        infoHash: candidate.infoHash,
        title: candidate.title,
        source: librarySource,
        totalBytes: candidate.totalBytes,
        pinned: candidate.pinned,
        selectedFilePath: candidate.selectedFilePath,
        position: candidate.position,
        duration: candidate.duration,
        progress: candidate.progress,
      });
      const stored = await readStoredRecord(saved.id);
      if (stored) {
        stored.createdAt = positiveNumber(candidate.createdAt, stored.createdAt);
        stored.updatedAt = positiveNumber(candidate.updatedAt, stored.updatedAt);
        stored.lastOpenedAt = positiveNumber(candidate.lastOpenedAt, stored.lastOpenedAt);
        stored.openCount = Math.floor(positiveNumber(candidate.openCount));
        await putStoredRecord(stored);
      }
      result.imported += 1;
    } catch (error) {
      result.skipped += 1;
      if (result.errors.length < 10) {
        result.errors.push(
          `Record ${index + 1}: ${error instanceof Error ? error.message : "invalid record"}`,
        );
      }
    }
  }
  if (envelope.records.length > LIBRARY_LIMITS.maxEntries) {
    result.skipped += envelope.records.length - LIBRARY_LIMITS.maxEntries;
    result.errors.push(`Only ${LIBRARY_LIMITS.maxEntries} records can be imported.`);
  }
  return result;
}

export async function getLibraryStorageStatus(): Promise<LibraryStorageStatus> {
  const [database, records] = await Promise.all([
    openLocalDatabase(),
    readStoredRecords(),
  ]);
  let persisted = false;
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;

  if (typeof navigator !== "undefined" && navigator.storage) {
    try {
      persisted = (await navigator.storage.persisted?.()) ?? false;
      const estimate = await navigator.storage.estimate?.();
      usageBytes = estimate?.usage ?? null;
      quotaBytes = estimate?.quota ?? null;
    } catch {
      // Storage estimation is optional and privacy-gated in some browsers.
    }
  }

  return {
    backend: database ? "indexeddb" : "memory",
    persisted,
    recordCount: records.length,
    sourceBytes: records.reduce(
      (sum, record) =>
        sum +
        (record.source.kind === "magnet"
          ? record.source.value.length * 2
          : record.source.value.byteLength),
      0,
    ),
    usageBytes,
    quotaBytes,
  };
}
