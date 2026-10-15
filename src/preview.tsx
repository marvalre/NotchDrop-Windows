// Dev-only: renders the app in a normal browser with Tauri's IPC mocked, to look at the UI.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const art = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#ff7ab6'/><stop offset='1' stop-color='#5e9bff'/></linearGradient></defs><rect width='300' height='300' fill='url(#g)'/><circle cx='150' cy='150' r='70' fill='rgba(255,255,255,.85)'/></svg>`);
let pos = 84;
mockWindows("island");
mockIPC((cmd, args) => {
  if (cmd === "media_state") { pos += 1; return { title: "Passionfruit", artist: "Drake", album: "More Life", app: "Spotify.exe", playing: true, position: pos, duration: 298, artwork: art, artworkKey: "k", canSeek: true }; }
  if (cmd === "plugin:notification|is_permission_granted") return true;
  if (cmd === "plugin:autostart|is_enabled") return false;
  if (cmd === "plugin:app|version") return "0.1.0";
  if (cmd === "plugin:event|listen") return 1;
  if (cmd === "volume_get" || cmd === "volume_set" || cmd === "volume_mute") return { level: 0.55, muted: false };
  if (cmd === "media_seek") return true;
  if (cmd === "tools_status") return { missing: ["yt-dlp", "ffmpeg", "ffprobe"] };
  if (cmd === "files_info") return (args as { paths: string[] }).paths.map((p, i) => ({ path: p, name: p.split("\\").pop(), bytes: [48_200_000, 3_400_000, 820_000][i % 3], exists: true, isDir: false, kind: ["video", "audio", "image"][i % 3], targets: [["mov", "webm", "gif", "mp3", "m4a", "wav"], ["m4a", "wav", "flac"], ["jpg", "webp", "bmp", "tiff", "gif"]][i % 3] }));
  return null;
});
localStorage.setItem("clipboard", JSON.stringify(["Quiero que continúes\nun proyecto que empecé con Codex: crear y vender páginas web", "https://youtu.be/dQw4w9WgXcQ"]));
localStorage.setItem("shelf", JSON.stringify(["C:\\Users\\Marcelo\\Downloads\\video-viral.mp4", "C:\\Users\\Marcelo\\Downloads\\cancion.mp3", "C:\\Users\\Marcelo\\Downloads\\portada.png"]));
localStorage.setItem("prefs", JSON.stringify({ hoverOpen: true, persistClipboard: true }));
const now = Date.now();
localStorage.setItem("alarms", JSON.stringify(JSON.stringify([{ id: "a", end: now + 8.5 * 60_000, minutes: 10 }, { id: "b", end: now + 44 * 60_000, minutes: 45 }])));
await import("./main");
