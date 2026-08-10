import assert from "node:assert/strict";
import test from "node:test";

import {
  getMime,
  mapTorrentFile,
} from "../src/torrent/torrent-files.ts";

test("known extensions override generic or incorrect runtime MIME guesses", () => {
  assert.equal(getMime("mkv", "application/octet-stream"), "video/x-matroska");
  assert.equal(getMime("mkv", "video/mp4"), "video/x-matroska");
  assert.equal(getMime("mp4", "application/octet-stream"), "video/mp4");
});

test("unknown extensions retain a useful runtime MIME type", () => {
  assert.equal(getMime("bin", "application/custom"), "application/custom");
  assert.equal(getMime("bin"), "application/octet-stream");
});

test("file mapping keeps an MKV container honest", () => {
  const file = mapTorrentFile({
    name: "sample.mkv",
    path: "sample.mkv",
    length: 1024,
    type: "video/mp4",
    streamURL: "http://localhost/sample.mkv",
    async blob() {
      return new Blob();
    },
  });

  assert.equal(file.extension, "mkv");
  assert.equal(file.mime, "video/x-matroska");
  assert.equal(file.category, "video");
});
