import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const IMAGE_URL = "https://dongjane.com/og-image.png";

describe("social share card", () => {
  const html = read("../index.html").toString("utf8");

  it("points open graph and twitter at the absolute share image", () => {
    expect(html).toContain(`<meta property="og:image" content="${IMAGE_URL}" />`);
    expect(html).toContain(`<meta name="twitter:image" content="${IMAGE_URL}" />`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it("ships a 1200x630 png for the share image", () => {
    const png = read("../public/og-image.png");
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });
});
