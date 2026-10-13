import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { appName } from "./api";

describe("appName", () => {
  it("nombres legibles de las apps más comunes", () => {
    expect(appName("Spotify.exe")).toBe("Spotify");
    expect(appName("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic")).toBe("Reproductor multimedia");
    expect(appName("MSEdge")).toBe("Edge");
    expect(appName("C:\\Apps\\vlc.exe")).toBe("vlc");
    expect(appName("")).toBe("Música");
  });
});

import { baseName, errorText, formatBytes } from "./api";
describe("helpers de archivos", () => {
  it("formatBytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatBytes(NaN)).toBe("—");
  });
  it("baseName con rutas de Windows y de Unix", () => {
    expect(baseName("C:\\Users\\a\\Downloads\\clip.mp4")).toBe("clip.mp4");
    expect(baseName("/tmp/x/foto.png")).toBe("foto.png");
  });
  it("errorText traduce MISSING_TOOLS", () => {
    expect(errorText("MISSING_TOOLS")).toContain("Instalar herramientas");
    expect(errorText(new Error("boom"))).toBe("boom");
  });
});
