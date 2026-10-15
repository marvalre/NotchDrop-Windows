import { File, Film, Folder, Image, Music } from "lucide-react";
import type { FileKind } from "../lib/api";

export function FileIcon({ kind, isDir, size = 26 }: { kind?: FileKind; isDir?: boolean; size?: number }) {
  const Icon = isDir ? Folder : kind === "video" ? Film : kind === "audio" ? Music : kind === "image" ? Image : File;
  return <Icon size={size} strokeWidth={1.6} />;
}
