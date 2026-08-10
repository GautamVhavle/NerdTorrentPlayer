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

const DATABASE_NAME = "torrent-exe";
const DATABASE_VERSION = 1;
const STORE_NAME = "resume";

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "id",
        });
        store.createIndex("lastOpenedAt", "lastOpenedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function listResumeRecords(): Promise<ResumeRecord[]> {
  const database = await openDatabase();
  if (!database) return [];
  const transaction = database.transaction(STORE_NAME, "readonly");
  const records =
    (await requestResult(
      transaction.objectStore(STORE_NAME).getAll(),
    )) || [];
  database.close();
  return records
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, 20);
}

export async function getResumeRecord(
  infoHash: string,
  filePath: string,
): Promise<ResumeRecord | null> {
  const database = await openDatabase();
  if (!database) return null;
  const transaction = database.transaction(STORE_NAME, "readonly");
  const record = await requestResult<ResumeRecord>(
    transaction.objectStore(STORE_NAME).get(infoHash + ":" + filePath),
  );
  database.close();
  return record;
}

export async function saveResumeRecord(record: ResumeRecord): Promise<void> {
  const database = await openDatabase();
  if (!database) return;

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });

  const records = await new Promise<ResumeRecord[]>((resolve) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });

  const overflow = records
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(20);
  if (overflow.length) {
    await new Promise<void>((resolve) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      overflow.forEach((item) => store.delete(item.id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
  }
  database.close();
}

export async function clearResumeRecords(): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
  database.close();
}

