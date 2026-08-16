import { TorrentPlayerApp } from "@/src/components/TorrentPlayerApp";
import { redirect } from "next/navigation";

export default function LibraryPage() {
  if (process.env.APP_MODE === "landing") redirect("/");
  return <TorrentPlayerApp initialLibraryOpen />;
}
