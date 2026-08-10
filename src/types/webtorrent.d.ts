declare module "webtorrent/dist/webtorrent.min.js" {
  import type { RuntimeWebTorrentClient } from "../torrent/torrent-types";

  const WebTorrent: new (options?: Record<string, unknown>) => RuntimeWebTorrentClient;
  export default WebTorrent;
}

