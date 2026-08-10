import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "A private, browser-only WebTorrent player with file selection, custom controls, subtitles, sync tools, and resume support.";

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
      : host.startsWith("localhost")
        ? "http"
        : "https";
  let origin = "http://localhost:3000";
  try {
    origin = new URL(protocol + "://" + host.split(",")[0].trim()).origin;
  } catch {
    // The local origin is a safe fallback for malformed proxy headers.
  }

  return {
    metadataBase: new URL(origin),
    title: "TORRENT.EXE — Stream the Swarm",
    description,
    applicationName: "TORRENT.EXE",
    manifest: "/manifest.webmanifest",
    keywords: [
      "WebTorrent",
      "torrent streaming",
      "browser video player",
      "subtitles",
      "peer to peer",
    ],
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      url: origin,
      siteName: "TORRENT.EXE",
      title: "TORRENT.EXE — Stream the Swarm",
      description,
      images: [
        {
          url: origin + "/og.png",
          width: 1731,
          height: 909,
          alt: "TORRENT.EXE — Stream the Swarm",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "TORRENT.EXE — Stream the Swarm",
      description,
      images: [origin + "/og.png"],
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
