import { LandingPage } from "@/src/components/LandingPage";
import { TorrentPlayerApp } from "@/src/components/TorrentPlayerApp";

const isLandingDeployment = process.env.APP_MODE === "landing";

const softwareApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "NerdTorrentPlayer",
  applicationCategory: "MultimediaApplication",
  applicationSubCategory: "Peer-to-peer media player",
  operatingSystem: "Web, macOS, Windows, Linux",
  description:
    "A local-first torrent media player with piece-priority streaming, swarm telemetry, subtitles, resume support, and an optional native bridge.",
  url: "https://nerdtorrentplayer.vercel.app/",
  installUrl: "https://github.com/GautamVhavle/NerdTorrentPlayer#quick-start",
  downloadUrl: "https://github.com/GautamVhavle/NerdTorrentPlayer",
  codeRepository: "https://github.com/GautamVhavle/NerdTorrentPlayer",
  featureList: [
    "Piece-priority torrent streaming",
    "Conventional BitTorrent peers through a local bridge",
    "FFmpeg remux and HLS conversion",
    "Subtitles and timing controls",
    "Private on-device library and resume history",
    "Live swarm telemetry",
  ],
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Why can’t the full torrent player run on Vercel?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A hosted browser cannot open DHT, UDP trackers, conventional TCP peers, or run FFmpeg. NerdTorrentPlayer runs locally to access those capabilities through a private loopback bridge.",
      },
    },
    {
      "@type": "Question",
      name: "Does NerdTorrentPlayer download the entire torrent first?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. It prioritizes the selected media file and requests pieces around playback, subject to swarm health, file layout, and media compatibility.",
      },
    },
    {
      "@type": "Question",
      name: "Is torrent media uploaded to an application server?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. Torrent traffic travels between the local device and peers. Saved sources and resume data remain in local browser storage unless exported.",
      },
    },
  ],
};

export default function Home() {
  if (!isLandingDeployment) return <TorrentPlayerApp />;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([softwareApplicationSchema, faqSchema]).replace(/</g, "\\u003c"),
        }}
      />
      <LandingPage />
    </>
  );
}
