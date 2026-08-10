import type { TorrentSourceTransports } from "./torrent-types";

/**
 * The secure browser trackers currently shipped by WebTorrent's official
 * create-torrent package. Browser clients cannot use UDP/TCP trackers.
 */
export const OFFICIAL_WEBTORRENT_TRACKERS = [
  "wss://tracker.btorrent.xyz",
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.webtorrent.dev",
] as const;

const MAX_CUSTOM_TRACKERS = 5;

export interface PreparedBrowserTorrentId {
  value: string | Uint8Array;
  trackers: string[];
  publicFallbacksAdded: boolean;
  sourceTransports: TorrentSourceTransports;
}

function emptySourceTransports(): TorrentSourceTransports {
  return {
    wssTrackers: 0,
    udpTrackers: 0,
    httpTrackers: 0,
    otherTrackers: 0,
    webSeeds: 0,
    exactSources: 0,
  };
}

function normalizeSecureTracker(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "wss:" || !url.hostname) return null;
    if (url.username || url.password) return null;

    url.hash = "";
    if (url.pathname === "/" && !url.search) {
      return `wss://${url.host}`;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function uniqueSecureTrackers(
  values: Iterable<string>,
): string[] {
  const trackers: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeSecureTracker(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    trackers.push(normalized);
  }

  return trackers;
}

function getSourceTransportCounts(
  params: URLSearchParams,
): TorrentSourceTransports {
  const trackerSets = {
    wssTrackers: new Set<string>(),
    udpTrackers: new Set<string>(),
    httpTrackers: new Set<string>(),
    otherTrackers: new Set<string>(),
  };
  const webSeeds = new Set<string>();
  const exactSources = new Set<string>();

  const normalizeHttpSource = (value: string): string | null => {
    try {
      const url = new URL(value);
      if (
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        !url.hostname
      ) {
        return null;
      }
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  };

  for (const [rawKey, rawValue] of params) {
    const key = rawKey.toLowerCase();
    const value = rawValue.trim();
    if (!value) continue;

    if (key === "ws" || key === "as") {
      const normalized = normalizeHttpSource(value);
      if (normalized) webSeeds.add(normalized);
      continue;
    }
    if (key === "xs") {
      const normalized = normalizeHttpSource(value);
      if (normalized) exactSources.add(normalized);
      continue;
    }
    if (key !== "tr") continue;

    let normalized = value;
    let protocol = "";
    try {
      const url = new URL(value);
      protocol = url.protocol.toLowerCase();
      url.hash = "";
      normalized = url.toString();
    } catch {
      continue;
    }

    if (!new URL(normalized).hostname) continue;

    if (protocol === "wss:") {
      const secureTracker = normalizeSecureTracker(value);
      if (secureTracker) trackerSets.wssTrackers.add(secureTracker);
    } else if (protocol === "udp:") trackerSets.udpTrackers.add(normalized);
    else if (protocol === "http:" || protocol === "https:") {
      trackerSets.httpTrackers.add(normalized);
    } else trackerSets.otherTrackers.add(normalized);
  }

  return {
    wssTrackers: trackerSets.wssTrackers.size,
    udpTrackers: trackerSets.udpTrackers.size,
    httpTrackers: trackerSets.httpTrackers.size,
    otherTrackers: trackerSets.otherTrackers.size,
    webSeeds: webSeeds.size,
    exactSources: exactSources.size,
  };
}

export function getParsedTorrentFallbacks(isPrivate: boolean): string[] {
  return isPrivate ? [] : [...OFFICIAL_WEBTORRENT_TRACKERS];
}

/** Reads only the privacy policy needed before tracker discovery starts. */
export async function inspectTorrentPrivacy(
  value: Uint8Array,
): Promise<boolean | null> {
  try {
    // @ts-expect-error bencode currently ships JavaScript without declarations.
    const { default: bencode } = await import("bencode");
    const decoded = bencode.decode(value) as {
      info?: { private?: number | boolean };
    };
    if (!decoded.info) return null;
    return Boolean(decoded.info.private);
  } catch {
    return null;
  }
}

function prepareMagnet(value: string): PreparedBrowserTorrentId {
  const queryStart = value.indexOf("?");
  if (queryStart < 0) {
    return {
      value,
      trackers: [...OFFICIAL_WEBTORRENT_TRACKERS],
      publicFallbacksAdded: true,
      sourceTransports: emptySourceTransports(),
    };
  }

  const fragmentStart = value.indexOf("#", queryStart);
  const rawQuery = value.slice(
    queryStart + 1,
    fragmentStart < 0 ? undefined : fragmentStart,
  );
  const params = new URLSearchParams(rawQuery);
  const sourceTransports = getSourceTransportCounts(params);
  const preserved: Array<[string, string]> = [];
  const customTrackers: string[] = [];

  for (const [key, parameterValue] of params) {
    if (key.toLowerCase() === "tr") {
      customTrackers.push(parameterValue);
    } else {
      preserved.push([key, parameterValue]);
    }
  }

  // Reserve room for every official default while allowing swarm-specific WSS
  // trackers from the magnet. This prevents a malicious magnet from opening an
  // unbounded number of tracker WebSockets and WebRTC offers.
  const trackers = uniqueSecureTrackers([
    ...uniqueSecureTrackers(customTrackers).slice(0, MAX_CUSTOM_TRACKERS),
    ...OFFICIAL_WEBTORRENT_TRACKERS,
  ]);

  const encodedParameters = preserved.map(([key, parameterValue]) => {
    let encodedValue = encodeURIComponent(parameterValue);
    // parse-torrent/magnet-uri expects the xt URN delimiters to remain literal.
    if (key.toLowerCase() === "xt") {
      encodedValue = encodedValue.replaceAll(/%3A/gi, ":");
    }
    return `${encodeURIComponent(key)}=${encodedValue}`;
  });
  for (const tracker of trackers) {
    encodedParameters.push(`tr=${encodeURIComponent(tracker)}`);
  }

  return {
    value: `magnet:?${encodedParameters.join("&")}`,
    trackers,
    // A magnet does not expose the private bit from its info dictionary. The
    // fallback policy is therefore explicit here; byte-backed torrents below
    // never receive public fallbacks until their privacy can be known.
    publicFallbacksAdded: true,
    sourceTransports,
  };
}

/**
 * Removes tracker transports a secure browser cannot use and adds a bounded,
 * current WSS fallback pool. Non-magnet torrent IDs are passed through intact.
 */
export function prepareBrowserTorrentId(
  value: string | Uint8Array,
): PreparedBrowserTorrentId {
  if (typeof value !== "string" || !value.toLowerCase().startsWith("magnet:?")) {
    return {
      value,
      // A .torrent may be private. Injecting public trackers before parsing its
      // info dictionary would leak the info hash, so use only its embedded
      // trackers. Runtime diagnostics pick up embedded WSS URLs after parsing.
      trackers: [],
      publicFallbacksAdded: false,
      sourceTransports: emptySourceTransports(),
    };
  }

  return prepareMagnet(value);
}

/**
 * Prefer the localhost native transport only when a magnet explicitly declares
 * tracker routes the browser build cannot open and provides no browser-native
 * bootstrap of its own. This keeps WebTorrent/WSS sources on the browser engine
 * while allowing conventional UDP/HTTP-only swarms to use the optional helper.
 */
export function shouldPreferNativeTransport(
  value: string | Uint8Array,
): boolean {
  if (typeof value !== "string" || !value.toLowerCase().startsWith("magnet:?")) {
    return false;
  }

  const { sourceTransports } = prepareMagnet(value);
  const nativeTrackerRoutes =
    sourceTransports.udpTrackers + sourceTransports.httpTrackers;
  const browserBootstrapRoutes =
    sourceTransports.wssTrackers +
    sourceTransports.webSeeds +
    sourceTransports.exactSources;

  return nativeTrackerRoutes > 0 && browserBootstrapRoutes === 0;
}
