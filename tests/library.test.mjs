import assert from "node:assert/strict";
import test from "node:test";

const library = await import("../src/lib/library.ts");

const INFO_HASH = "0123456789abcdef0123456789abcdef01234567";
const SECOND_HASH = "89abcdef0123456789abcdef0123456789abcdef";
const MAGNET = `magnet:?xt=urn:btih:${INFO_HASH}&dn=Public%20Domain%20Film`;

test("keeps private sources out of safe records and default exports", async () => {
  await library.clearLibrary();

  await assert.rejects(
    library.saveLibraryRecord({
      consent: false,
      infoHash: INFO_HASH,
      title: "No consent",
      source: { kind: "magnet", value: MAGNET },
    }),
    /explicit consent/i,
  );

  const saved = await library.saveLibraryRecord({
    consent: true,
    infoHash: INFO_HASH.toUpperCase(),
    title: "Public Domain Film",
    source: { kind: "magnet", value: MAGNET },
    totalBytes: 1_000,
    selectedFilePath: "film.mp4",
    position: 25,
    duration: 100,
  });

  assert.equal(saved.id, INFO_HASH);
  assert.equal(saved.progress, 0.25);
  assert.equal(saved.sourceKind, "magnet");
  assert.doesNotMatch(JSON.stringify(saved), /magnet:\?/i);

  const source = await library.getLibrarySource(INFO_HASH);
  assert.deepEqual(source, { kind: "magnet", value: MAGNET });

  const safeExport = await library.exportLibrary();
  assert.doesNotMatch(safeExport, /magnet:\?/i);
  assert.match(safeExport, /"includesPrivateSources": false/);

  const privateExport = await library.exportLibrary({ includeSources: true });
  assert.match(privateExport, /magnet:\?xt=urn:btih/i);
  assert.match(privateExport, /"includesPrivateSources": true/);
});

test("updates, pins, touches, deletes, and restores local records", async () => {
  const updated = await library.updateLibraryRecord(INFO_HASH, {
    pinned: true,
    position: 75,
    duration: 100,
  });
  assert.equal(updated?.pinned, true);
  assert.equal(updated?.progress, 0.75);

  const touched = await library.touchLibraryRecord(INFO_HASH, {
    selectedFilePath: "bonus.mp4",
  });
  assert.equal(touched?.openCount, 1);
  assert.equal(touched?.selectedFilePath, "bonus.mp4");

  const backup = await library.exportLibrary({ includeSources: true });
  await library.clearLibrary();
  assert.deepEqual(await library.listLibraryRecords(), []);

  const result = await library.importLibrary(backup, {
    confirmSourceImport: true,
    mode: "merge",
  });
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 0);
  assert.equal((await library.listLibraryRecords()).length, 1);

  await library.deleteLibraryRecord(INFO_HASH);
  assert.equal(await library.getLibraryRecord(INFO_HASH), null);
});

test("copies .torrent bytes and reports the session fallback without IndexedDB", async () => {
  await library.clearLibrary();
  const original = new Uint8Array([100, 52, 58, 105, 110, 102, 111, 101]);
  await library.saveLibraryRecord({
    consent: true,
    infoHash: SECOND_HASH,
    title: "Byte-backed torrent",
    source: {
      kind: "torrent",
      value: original,
      fileName: "sample.torrent",
    },
  });
  original[0] = 0;

  const firstRead = await library.getLibrarySource(SECOND_HASH);
  assert.equal(firstRead?.kind, "torrent");
  if (firstRead?.kind === "torrent") firstRead.value[0] = 1;
  const secondRead = await library.getLibrarySource(SECOND_HASH);
  assert.equal(secondRead?.kind, "torrent");
  if (secondRead?.kind === "torrent") assert.equal(secondRead.value[0], 100);

  const status = await library.getLibraryStorageStatus();
  assert.equal(status.backend, "memory");
  assert.equal(status.recordCount, 1);
  assert.equal(status.sourceBytes, 8);

  await library.clearLibrary();
});
