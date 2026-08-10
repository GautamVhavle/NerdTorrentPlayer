import {
  openLocalDatabase,
  requestResult,
  RESUME_STORE_NAME,
  transactionFinished,
} from "./library";

export interface ResumeRecord {
  id: string;
  infoHash: string;
  torrentName: string;
  filePath: string;
  fileName: string;
  position: number;
  duration: number;
  subtitleOffset: number;
  lastOpenedAt: number;
}

const MAX_RESUME_RECORDS = 20;
const memoryResume = new Map<string, ResumeRecord>();
const deletedResumeIds = new Set<string>();

function safeResumeRecord(record: ResumeRecord): ResumeRecord | null {
  if (!record || typeof record.id !== "string") return null;
  const infoHash = String(record.infoHash || "").trim().toLowerCase();
  const filePath = String(record.filePath || "").slice(0, 2_048);
  if (!infoHash || !filePath) return null;
  const id = infoHash + ":" + filePath;
  const finite = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return {
    id,
    infoHash,
    torrentName: String(record.torrentName || "Untitled torrent").slice(0, 240),
    filePath,
    fileName: String(record.fileName || filePath).slice(0, 512),
    position: Math.max(0, finite(record.position)),
    duration: Math.max(0, finite(record.duration)),
    subtitleOffset: Math.max(-30, Math.min(30, finite(record.subtitleOffset))),
    lastOpenedAt: Math.max(0, finite(record.lastOpenedAt)) || Date.now(),
  };
}

async function persistedResumeRecords(): Promise<ResumeRecord[] | null> {
  const database = await openLocalDatabase();
  if (!database || !database.objectStoreNames.contains(RESUME_STORE_NAME)) {
    return null;
  }
  try {
    const transaction = database.transaction(RESUME_STORE_NAME, "readonly");
    return await requestResult<ResumeRecord[]>(
      transaction.objectStore(RESUME_STORE_NAME).getAll(),
    );
  } catch {
    return null;
  }
}

async function mergedResumeRecords(): Promise<ResumeRecord[]> {
  const persisted = (await persistedResumeRecords()) || [];
  const merged = new Map<string, ResumeRecord>();
  for (const candidate of persisted) {
    const record = safeResumeRecord(candidate);
    if (record && !deletedResumeIds.has(record.id)) merged.set(record.id, record);
  }
  for (const candidate of memoryResume.values()) {
    const record = safeResumeRecord(candidate);
    if (record && !deletedResumeIds.has(record.id)) merged.set(record.id, record);
  }
  return [...merged.values()].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function listResumeRecords(): Promise<ResumeRecord[]> {
  return (await mergedResumeRecords()).slice(0, MAX_RESUME_RECORDS);
}

export async function getResumeRecord(
  infoHash: string,
  filePath: string,
): Promise<ResumeRecord | null> {
  const id = infoHash.trim().toLowerCase() + ":" + filePath;
  if (deletedResumeIds.has(id)) return null;
  const fallback = memoryResume.get(id);
  if (fallback) return { ...fallback };

  const database = await openLocalDatabase();
  if (!database || !database.objectStoreNames.contains(RESUME_STORE_NAME)) {
    return null;
  }
  try {
    const transaction = database.transaction(RESUME_STORE_NAME, "readonly");
    const result = await requestResult<ResumeRecord>(
      transaction.objectStore(RESUME_STORE_NAME).get(id),
    );
    return result ? safeResumeRecord(result) : null;
  } catch {
    return null;
  }
}

export async function saveResumeRecord(record: ResumeRecord): Promise<void> {
  const safe = safeResumeRecord(record);
  if (!safe) return;
  const database = await openLocalDatabase();
  let persisted = false;
  if (database && database.objectStoreNames.contains(RESUME_STORE_NAME)) {
    try {
      const transaction = database.transaction(RESUME_STORE_NAME, "readwrite");
      transaction.objectStore(RESUME_STORE_NAME).put(safe);
      persisted = await transactionFinished(transaction);
    } catch {
      persisted = false;
    }
  }
  deletedResumeIds.delete(safe.id);
  if (persisted) memoryResume.delete(safe.id);
  else memoryResume.set(safe.id, safe);

  const overflow = (await mergedResumeRecords()).slice(MAX_RESUME_RECORDS);
  if (overflow.length) {
    await Promise.all(overflow.map((item) => deleteResumeRecord(item.id)));
  }
}

async function deleteResumeRecord(id: string): Promise<void> {
  memoryResume.delete(id);
  const database = await openLocalDatabase();
  let persisted = false;
  if (database && database.objectStoreNames.contains(RESUME_STORE_NAME)) {
    try {
      const transaction = database.transaction(RESUME_STORE_NAME, "readwrite");
      transaction.objectStore(RESUME_STORE_NAME).delete(id);
      persisted = await transactionFinished(transaction);
    } catch {
      persisted = false;
    }
  }
  if (persisted) deletedResumeIds.delete(id);
  else deletedResumeIds.add(id);
}

export async function clearResumeRecords(): Promise<void> {
  const known = await listResumeRecords();
  memoryResume.clear();
  const database = await openLocalDatabase();
  let persisted = false;
  if (database && database.objectStoreNames.contains(RESUME_STORE_NAME)) {
    try {
      const transaction = database.transaction(RESUME_STORE_NAME, "readwrite");
      transaction.objectStore(RESUME_STORE_NAME).clear();
      persisted = await transactionFinished(transaction);
    } catch {
      persisted = false;
    }
  }
  if (persisted) deletedResumeIds.clear();
  else known.forEach((record) => deletedResumeIds.add(record.id));
}
