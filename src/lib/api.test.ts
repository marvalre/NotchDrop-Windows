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
