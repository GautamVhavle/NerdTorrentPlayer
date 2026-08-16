"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Captions,
  Check,
  ChevronRight,
  CircleDot,
  Clipboard,
  Code2,
  Download,
  Film,
  Gauge,
  GitFork,
  HardDrive,
  LockKeyhole,
  Network,
  Play,
  Radio,
  ShieldCheck,
  Terminal,
  Waypoints,
  Zap,
} from "lucide-react";
import { useState } from "react";
import styles from "./LandingPage.module.css";

const REPOSITORY_URL = "https://github.com/GautamVhavle/NerdTorrentPlayer";
const INSTALL_COMMAND = `git clone ${REPOSITORY_URL}.git
cd NerdTorrentPlayer
npm install
npm run dev`;

const features = [
  {
    icon: Zap,
    index: "01",
    title: "Start before it finishes",
    copy: "Pieces are prioritized around playback, so compatible media can begin while the swarm is still arriving.",
  },
  {
    icon: Network,
    index: "02",
    title: "The whole BitTorrent network",
    copy: "The local bridge reaches DHT, TCP peers, and UDP or HTTP trackers—not only browser WebRTC peers.",
  },
  {
    icon: Film,
    index: "03",
    title: "Real-world media support",
    copy: "Play browser-ready files directly and use local FFmpeg remuxing or HLS conversion when containers need help.",
  },
  {
    icon: Captions,
    index: "04",
    title: "Built for watching",
    copy: "Subtitles, timing controls, episode switching, keyboard shortcuts, picture-in-picture, and resume are included.",
  },
  {
    icon: Gauge,
    index: "05",
    title: "No mystery spinner",
    copy: "See peers, trackers, speed, progress, buffer health, and transport state while the stream is running.",
  },
  {
    icon: LockKeyhole,
    index: "06",
    title: "Local by design",
    copy: "Sources and watch history stay on your device. The native helper binds to loopback and uses capability tokens.",
  },
];

const faqs = [
  {
    question: "Why can’t the full player run on Vercel?",
    answer:
      "A hosted browser can only connect to WebTorrent-compatible WebRTC peers and secure WebSocket trackers. Conventional torrents also rely on TCP or uTP peers, UDP trackers, DHT, and sometimes FFmpeg—capabilities that require a local native process.",
  },
  {
    question: "Does NerdTorrentPlayer download the entire torrent first?",
    answer:
      "No. It prioritizes the selected media file and requests pieces around playback. How quickly playback begins still depends on swarm health, file layout, bitrate, and whether conversion is required.",
  },
  {
    question: "What do I need to install?",
    answer:
      "Node.js 22.13 or newer is required. FFmpeg is recommended for MKV, HEVC, incompatible audio, remuxing, and HLS conversion. The standard npm run dev command starts both the app and its private local bridge.",
  },
  {
    question: "Is my torrent data uploaded to a server?",
    answer:
      "NerdTorrentPlayer has no application server for storing your media. Torrent traffic goes between your device and peers, while saved sources and resume data remain in local browser storage. As with every torrent client, swarm peers can see your public IP address.",
  },
];

function Brand() {
  return (
    <span className={styles.brand}>
      <span className={styles.brandMark} aria-hidden="true">
        <Waypoints size={17} strokeWidth={2.2} />
        <i />
      </span>
      <span className={styles.brandName}>
        NerdTorrent<span>Player</span>
      </span>
    </span>
  );
}

function CopyCommand({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={`${styles.command} ${compact ? styles.commandCompact : ""}`}>
      <div className={styles.commandTopbar}>
        <span>
          <Terminal size={13} aria-hidden="true" /> quick-start.sh
        </span>
        <button type="button" onClick={copy} aria-label="Copy install commands">
          {copied ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre aria-label="Installation commands">
        <code>
          <span>$</span> git clone {REPOSITORY_URL}.git{"\n"}
          <span>$</span> cd NerdTorrentPlayer{"\n"}
          <span>$</span> npm install{"\n"}
          <span>$</span> npm run dev
        </code>
      </pre>
      <div className={styles.commandStatus}>
        <span><i /> Player → localhost:3000</span>
        <span><i /> Native bridge → 127.0.0.1:41780</span>
      </div>
    </div>
  );
}

function ProductPreview() {
  return (
    <div className={styles.previewWrap} aria-label="NerdTorrentPlayer interface preview">
      <div className={styles.previewGlow} />
      <div className={styles.previewWindow}>
        <div className={styles.previewTopbar}>
          <div className={styles.previewBrand}>
            <Waypoints size={13} aria-hidden="true" />
            <b>NERDTORRENT</b>
          </div>
          <span className={styles.previewLive}><i /> BRIDGE ONLINE</span>
          <div className={styles.previewDots}><i /><i /><i /></div>
        </div>
        <div className={styles.previewBody}>
          <div className={styles.previewPlayer}>
            <div className={styles.previewGrid} />
            <div className={styles.previewPlay}><Play size={24} fill="currentColor" /></div>
            <div className={styles.previewNowPlaying}>
              <small>NOW STREAMING / 01</small>
              <strong>Sintel.2010.1080p.mp4</strong>
            </div>
            <div className={styles.previewControls}>
              <Play size={12} fill="currentColor" />
              <span><i /></span>
              <b>18:42 / 00:14:48</b>
            </div>
          </div>
          <aside className={styles.previewTelemetry}>
            <span className={styles.telemetryLabel}>SWARM TELEMETRY</span>
            <div className={styles.telemetrySpeed}>
              <small>DOWNLINK</small>
              <strong>8.4 <b>MB/s</b></strong>
            </div>
            <div className={styles.telemetryBars}>
              {[31, 48, 38, 62, 46, 75, 56, 88, 68, 94, 73, 83, 64, 91, 78, 98].map((height, index) => (
                <i key={`${height}-${index}`} style={{ height: `${height}%` }} />
              ))}
            </div>
            <dl>
              <div><dt>Peers</dt><dd>24</dd></div>
              <div><dt>Buffer</dt><dd>42.8s</dd></div>
              <div><dt>Health</dt><dd className={styles.healthy}>Stable</dd></div>
            </dl>
          </aside>
        </div>
      </div>
      <span className={`${styles.previewCallout} ${styles.calloutOne}`}><i /> Piece-priority streaming</span>
      <span className={`${styles.previewCallout} ${styles.calloutTwo}`}><i /> Native swarm active</span>
    </div>
  );
}

export function LandingPage() {
  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#content">Skip to content</a>
      <div className={styles.noise} aria-hidden="true" />

      <header className={styles.header}>
        <a href="#top" aria-label="NerdTorrentPlayer home"><Brand /></a>
        <nav aria-label="Landing page navigation">
          <a href="#why-local">Why local</a>
          <a href="#features">Features</a>
          <a href="#install">Install</a>
        </nav>
        <a className={styles.githubButton} href={REPOSITORY_URL} target="_blank" rel="noreferrer">
          <GitFork size={16} aria-hidden="true" />
          <span>View on GitHub</span>
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </header>

      <div id="content">
        <section className={styles.hero} id="top">
          <div className={styles.heroSignal} aria-hidden="true">
            <span>WEB INTERFACE</span><i /><b>LOCAL ENGINE</b>
          </div>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}><Radio size={13} /> SOURCE AVAILABLE · LOCAL FIRST · REAL BITTORRENT</div>
            <h1>Don’t wait for the download.<br /><span>Watch the swarm.</span></h1>
            <p>
              NerdTorrentPlayer is a local-first torrent media player that prioritizes the pieces you’re watching,
              reaches conventional BitTorrent peers, and turns the swarm into a clean, capable streaming experience.
            </p>
            <div className={styles.heroActions}>
              <a className={styles.primaryButton} href="#install">
                <Download size={17} aria-hidden="true" /> Install locally <ArrowRight size={16} aria-hidden="true" />
              </a>
              <a className={styles.secondaryButton} href={REPOSITORY_URL} target="_blank" rel="noreferrer">
                <GitFork size={17} aria-hidden="true" /> Explore the source
              </a>
            </div>
            <div className={styles.heroProof}>
              <span><Check size={13} /> No account</span>
              <span><Check size={13} /> No media upload</span>
              <span><Check size={13} /> macOS, Windows & Linux</span>
            </div>
          </div>
          <ProductPreview />
          <div className={styles.heroRail} aria-hidden="true">
            <span>01 / LOAD SOURCE</span><i /><span>02 / SELECT MEDIA</span><i /><span>03 / STREAM</span>
          </div>
        </section>

        <section className={styles.truthSection} id="why-local">
          <div className={styles.sectionIntro}>
            <span className={styles.sectionIndex}>01 — THE HONEST PART</span>
            <h2>The web can show the player.<br /><span>Your machine unlocks the network.</span></h2>
            <p>
              Browsers are intentionally sandboxed. A Vercel page cannot open DHT, UDP trackers, TCP peers, or run
              FFmpeg. NerdTorrentPlayer keeps the interface in your browser and adds a private loopback bridge for
              the capabilities real-world torrents need.
            </p>
          </div>
          <article className={styles.localRuntimeCard}>
            <div className={styles.runtimeLead}>
              <span className={styles.runtimeIcon}><HardDrive size={22} aria-hidden="true" /></span>
              <div>
                <span className={styles.runtimeLabel}>LOCAL RUNTIME / FULL PLAYER</span>
                <h3>Everything runs where it should:<br /><strong>on your machine.</strong></h3>
                <p>The website is the product guide. Clone the repository and start it locally to open the actual player with its private native bridge.</p>
              </div>
            </div>
            <ul className={styles.runtimeCapabilities}>
              <li><Check size={14} /> DHT and conventional peers</li>
              <li><Check size={14} /> UDP, HTTP, and WSS trackers</li>
              <li><Check size={14} /> FFmpeg remux and HLS conversion</li>
              <li><Check size={14} /> Private on-device library</li>
              <li><Check size={14} /> Full playback workflow</li>
              <li><Check size={14} /> Loopback-only native bridge</li>
            </ul>
            <a className={styles.runtimeAction} href="#install">
              Install the local player <ArrowRight size={15} aria-hidden="true" />
            </a>
          </article>
        </section>

        <section className={styles.featuresSection} id="features">
          <div className={styles.sectionIntroRow}>
            <div className={styles.sectionIntro}>
              <span className={styles.sectionIndex}>02 — BUILT TO PLAY</span>
              <h2>A torrent client that thinks<br /><span>like a media player.</span></h2>
            </div>
            <p>From first peer to final frame, every part of the interface is built around getting you watching—and keeping you informed.</p>
          </div>
          <div className={styles.featureGrid}>
            {features.map(({ icon: Icon, index, title, copy }) => (
              <article key={index}>
                <div className={styles.featureIcon}><Icon size={20} aria-hidden="true" /></div>
                <span>{index}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
                <i aria-hidden="true" />
              </article>
            ))}
          </div>
        </section>

        <section className={styles.flowSection}>
          <div className={styles.sectionIntro}>
            <span className={styles.sectionIndex}>03 — ZERO CEREMONY</span>
            <h2>Clone. Start. <span>Stream.</span></h2>
            <p>One command starts the web interface and the loopback-only native bridge together.</p>
          </div>
          <div className={styles.flowGrid}>
            <article><b>01</b><div><Code2 size={20} /><h3>Clone the repo</h3><p>Get the public project source from GitHub.</p></div><ChevronRight /></article>
            <article><b>02</b><div><Terminal size={20} /><h3>Run npm install</h3><p>Install the app and local bridge dependencies.</p></div><ChevronRight /></article>
            <article><b>03</b><div><Play size={20} /><h3>Start the player</h3><p>Open localhost, paste a magnet, and choose a file.</p></div></article>
          </div>
        </section>

        <section className={styles.installSection} id="install">
          <div className={styles.installCopy}>
            <span className={styles.sectionIndex}>04 — RUN IT LOCALLY</span>
            <h2>Your next stream is<br /><span>four commands away.</span></h2>
            <p>
              Requires Node.js 22.13+. Install FFmpeg for MKV, HEVC, remuxing, and browser-safe conversion.
              NerdTorrentPlayer will open the player directly—this landing page stays on the hosted site.
            </p>
            <div className={styles.requirements}>
              <span><CircleDot size={13} /> Node.js 22.13+</span>
              <span><CircleDot size={13} /> FFmpeg recommended</span>
              <span><CircleDot size={13} /> Modern browser</span>
            </div>
            <a href={`${REPOSITORY_URL}#quick-start`} target="_blank" rel="noreferrer">
              Read the full setup guide <ArrowUpRight size={14} />
            </a>
          </div>
          <CopyCommand />
        </section>

        <section className={styles.privacySection}>
          <div className={styles.privacyBadge}><ShieldCheck size={29} /></div>
          <div>
            <span className={styles.sectionIndex}>LOCAL-FIRST BY DEFAULT</span>
            <h2>Your media is not our business.</h2>
            <p>No hosted torrent backend, no account, and no application server storing your files. The bridge listens only on loopback, while sources and playback history stay on your device.</p>
          </div>
          <div className={styles.privacyStats}>
            <span><strong>0</strong><small>Cloud uploads</small></span>
            <span><strong>127.0.0.1</strong><small>Bridge address</small></span>
            <span><strong>PUBLIC</strong><small>Source on GitHub</small></span>
          </div>
        </section>

        <section className={styles.faqSection} id="faq">
          <div className={styles.sectionIntro}>
            <span className={styles.sectionIndex}>05 — QUESTIONS, ANSWERED</span>
            <h2>Before you <span>press play.</span></h2>
          </div>
          <div className={styles.faqList}>
            {faqs.map((faq, index) => (
              <details key={faq.question} open={index === 0}>
                <summary><span>{String(index + 1).padStart(2, "0")}</span>{faq.question}<i /></summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={styles.finalCta}>
          <div className={styles.ctaOrb} aria-hidden="true"><Waypoints size={52} /></div>
          <span className={styles.sectionIndex}>THE SWARM IS READY</span>
          <h2>Stop waiting.<br /><span>Start watching.</span></h2>
          <p>Source-available, local-first torrent streaming with a player built for the way you actually watch.</p>
          <div className={styles.heroActions}>
            <a className={styles.primaryButton} href="#install"><Download size={17} /> Install NerdTorrentPlayer <ArrowRight size={16} /></a>
            <a className={styles.secondaryButton} href={REPOSITORY_URL} target="_blank" rel="noreferrer"><GitFork size={17} /> Star on GitHub</a>
          </div>
        </section>
      </div>

      <footer className={styles.footer}>
        <Brand />
        <p>Local-first hybrid P2P streaming.</p>
        <nav aria-label="Footer navigation">
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a href={`${REPOSITORY_URL}#privacy-and-security`} target="_blank" rel="noreferrer">Privacy</a>
          <a href={`${REPOSITORY_URL}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer">Contribute</a>
        </nav>
        <small>Built by <a href="https://gautamvhavle.xyz/" target="_blank" rel="noreferrer">Gautam Vhavle</a></small>
      </footer>
    </main>
  );
}
