import { invoke } from "@tauri-apps/api/core";

export interface MediaInfo {
  title: string; artist: string; album: string; app: string;
  playing: boolean; position: number; duration: number;
  artwork: string | null; artworkKey: string;
}

export const setExpanded = (expanded: boolean, focus = false) => invoke<void>("set_expanded", { expanded, focus });
export const mediaState = (knownKey: string) => invoke<MediaInfo | null>("media_state", { knownKey });
export const mediaCommand = (action: "toggle" | "next" | "previous") => invoke<boolean>("media_command", { action });
export const copyText = (text: string) => invoke<void>("copy_text", { text });
export const quitApp = () => invoke<void>("quit_app");

/** "Spotify.exe" → "Spotify", "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic" → "Reproductor multimedia". */
export function appName(aumid: string): string {
  const a = aumid.toLowerCase();
  if (a.includes("spotify")) return "Spotify";
  if (a.includes("chrome")) return "Chrome";
  if (a.includes("msedge")) return "Edge";
  if (a.includes("firefox")) return "Firefox";
  if (a.includes("zunemusic") || a.includes("media.player")) return "Reproductor multimedia";
  const last = aumid.split(/[!\\/]/).pop() ?? "";
  return last.replace(/\.exe$/i, "") || "Música";
}
