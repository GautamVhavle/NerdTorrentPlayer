import { createBridge } from "./server.mjs";

const bridge = createBridge();
const address = await bridge.listen();

console.log(`WebTorrent native bridge listening at ${address.url}`);
console.log("The bridge accepts only localhost NerdTorrentPlayer origins and magnet URIs.");
console.log("Open GET /v1/capabilities from the local app to begin a session.");

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Stopping native bridge (${signal})...`);
  await bridge.close();
}

process.once("SIGINT", () => {
  void stop("SIGINT");
});
process.once("SIGTERM", () => {
  void stop("SIGTERM");
});
