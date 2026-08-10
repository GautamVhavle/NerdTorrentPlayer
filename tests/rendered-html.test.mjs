import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", String(Date.now()));
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://torrent-exe.test/", {
      headers: {
        accept: "text/html",
        host: "torrent-exe.test",
        "x-forwarded-host": "torrent-exe.test",
        "x-forwarded-proto": "https",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished torrent player landing screen", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>TORRENT\.EXE — Stream the Swarm<\/title>/i);
  assert.match(html, /STREAM/);
  assert.match(html, /THE SWARM/);
  assert.match(html, /Magnet link/);
  assert.match(html, /Connect to swarm/);
  assert.match(html, /Drop a \.torrent file here/);
  assert.match(html, /WebTorrent\s*\/\s*WebRTC peers only/i);
  assert.match(html, /https:\/\/torrent-exe\.test\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|taking shape/i);
});

test("ships the WebTorrent streaming bridge and branded social card", async () => {
  const sourceWorker = new URL("../public/sw.min.js", import.meta.url);
  const builtWorker = new URL("../dist/client/sw.min.js", import.meta.url);
  const sourceCard = new URL("../public/og.png", import.meta.url);
  const builtCard = new URL("../dist/client/og.png", import.meta.url);

  await Promise.all([
    access(sourceWorker),
    access(builtWorker),
    access(sourceCard),
    access(builtCard),
  ]);

  const [workerSource, sourceCardStat, builtCardStat] = await Promise.all([
    readFile(sourceWorker, "utf8"),
    stat(sourceCard),
    stat(builtCard),
  ]);

  assert.match(workerSource, /webtorrent\/keepalive/);
  assert.match(workerSource, /clients\.claim/);
  assert.ok(sourceCardStat.size > 100_000);
  assert.equal(sourceCardStat.size, builtCardStat.size);
});

test("keeps WebTorrent browser-only and removes starter dependencies", async () => {
  const [clientSource, packageJson, page] = await Promise.all([
    readFile(
      new URL("../src/torrent/torrent-client.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /import\("webtorrent\/dist\/webtorrent\.min\.js"\)/);
  assert.match(clientSource, /navigator\.serviceWorker\.register/);
  assert.match(clientSource, /createServer/);
  assert.match(clientSource, /deselect:\s*true/);
  assert.match(page, /TorrentPlayerApp/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /_sites-preview|codex-preview/);
});

