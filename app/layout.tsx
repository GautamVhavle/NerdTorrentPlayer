import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  preload: false,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

const isLandingDeployment = process.env.APP_MODE === "landing";
const productionOrigin = "https://nerdtorrentplayer.vercel.app";

const playerDescription =
  "A fast-start local torrent player with a private on-device library, native swarm support, advanced telemetry, subtitles, and resume support.";
const landingDescription =
  "Stream torrent media with a local-first player. Reach conventional BitTorrent peers, view live swarm telemetry, and use FFmpeg playback support.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ||
    requestHeaders.get("host") ||
    "localhost:3000";
  const requestedProtocol = requestHeaders.get("x-forwarded-proto");
  const protocol =
    requestedProtocol === "http" || requestedProtocol === "https"
      ? requestedProtocol
      : host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https";
  let requestOrigin = "http://localhost:3000";
  try {
    requestOrigin = new URL(`${protocol}://${host.split(",")[0].trim()}`).origin;
  } catch {
    // The local origin is a safe fallback for malformed proxy headers.
  }

  const origin = isLandingDeployment ? productionOrigin : requestOrigin;
  const title = isLandingDeployment
    ? "NerdTorrentPlayer | Local-First Torrent Streaming Player"
    : "NerdTorrentPlayer - Stream the Swarm";
  const description = isLandingDeployment ? landingDescription : playerDescription;

  return {
    metadataBase: new URL(origin),
    title,
    description,
    applicationName: "NerdTorrentPlayer",
    manifest: "/manifest.webmanifest",
    alternates: isLandingDeployment ? { canonical: "/" } : undefined,
    keywords: [
      "NerdTorrentPlayer",
      "local torrent player",
      "torrent streaming player",
      "WebTorrent media player",
      "BitTorrent video player",
      "peer to peer media player",
      "torrent player with subtitles",
    ],
    authors: [{ name: "Gautam Vhavle", url: "https://gautamvhavle.xyz/" }],
    creator: "Gautam Vhavle",
    robots: isLandingDeployment
      ? {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
          },
        }
      : { index: false, follow: false },
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/favicon.ico", sizes: "any" },
      ],
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: origin,
      siteName: "NerdTorrentPlayer",
      title,
      description,
      images: [
        {
          url: "/og.png",
          width: 1731,
          height: 909,
          alt: "NerdTorrentPlayer local-first peer-to-peer media player and swarm network",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#05070a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
