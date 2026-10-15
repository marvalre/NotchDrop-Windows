import { invoke } from "@tauri-apps/api/core";

export interface MediaInfo {
  title: string; artist: string; album: string; app: string;
  playing: boolean; position: number; duration: number;
  artwork: string | null; artworkKey: string; canSeek: boolean;
}

export const setExpanded = (expanded: boolean, focus = false, panel?: number) => invoke<void>("set_expanded", { expanded, focus, panel: panel ?? null });
export const mediaState = (knownKey: string) => invoke<MediaInfo | null>("media_state", { knownKey });
export const mediaCommand = (action: "toggle" | "next" | "previous") => invoke<boolean>("media_command", { action });
export const copyText = (text: string) => invoke<void>("copy_text", { text });
export const copyImage = (dataUrl: string) => invoke<void>("copy_image", { dataUrl });
export const mediaSeek = (seconds: number) => invoke<boolean>("media_seek", { seconds });
export interface Volume { level: number; muted: boolean; }
export const volumeGet = () => invoke<Volume | null>("volume_get");
export const volumeSet = (level: number) => invoke<Volume | null>("volume_set", { level });
export const volumeMute = (muted: boolean) => invoke<Volume | null>("volume_mute", { muted });
export const openSpecial = (target: "sound" | "clock" | "downloads" | "release") => invoke<void>("open_special", { target });
export const quitApp = () => invoke<void>("quit_app");

export type FileKind = "video" | "audio" | "image" | "unsupported";
export interface FileInfo { path: string; name: string; bytes: number; exists: boolean; isDir: boolean; kind: FileKind; targets: string[]; }
export interface Done { path: string; bytes: number; originalBytes: number; }

export const toolsStatus = () => invoke<{ missing: string[] }>("tools_status");
export const installTools = () => invoke<void>("install_tools");
export const downloadMedia = (url: string, format: "mp4" | "mp3", cookies: string | null) => invoke<string>("download_media", { url, format, cookies });
export const filesInfo = (paths: string[]) => invoke<FileInfo[]>("files_info", { paths });
export const convertFile = (path: string, target: string) => invoke<Done>("convert_file", { path, target });
export const compressFile = (path: string, percent: number) => invoke<Done>("compress_file", { path, percent });
export const openFile = (path: string) => invoke<void>("open_file", { path });
export const revealFile = (path: string) => invoke<void>("reveal_file", { path });
export const dragIcon = () => invoke<string>("drag_icon");

/** Errors from Rust come back as plain strings; "MISSING_TOOLS" means yt-dlp/ffmpeg aren't installed. */
export function errorText(e: unknown): string {
  const s = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  return s === "MISSING_TOOLS" ? "Faltan las herramientas gratuitas (yt-dlp y ffmpeg). Pulsa «Instalar herramientas»." : s;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

/** "C:\Users\a\Downloads\clip.mp4" → "clip.mp4" (both separators). */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

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
