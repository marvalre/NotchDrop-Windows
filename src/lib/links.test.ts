import { describe, expect, it } from "vitest";
import { isSupportedLink } from "./links";

describe("isSupportedLink (igual que en Rust)", () => {
  it.each([
    [" https://www.tiktok.com/@x/video/1 ", true],
    ["http://youtu.be/abc", true],
    ["ftp://x.com/a", false],
    ["hola mundo", false],
    ["https://localhost", false],
    ["https://x.com/a b", false],
  ])("%j → %s", (s, want) => expect(isSupportedLink(s)).toBe(want));
});
