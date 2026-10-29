import { describe, expect, it } from "vitest";
import { CREDITS, creditLine } from "../src/ui/credits.ts";

describe("credits", () => {
  it("name the Korean chant's author and licence", () => {
    const chant = CREDITS.find((credit) => credit.title === "염불소리1");
    expect(chant?.author).toBe("김용배");
    expect(chant?.licence).toBe("CC BY");
  });

  it("name the museum's seated Buddha, free to use with its name credited", () => {
    const buddha = CREDITS.find((credit) => credit.title === "부여 군수리 석조여래좌상");
    expect(buddha?.author).toBe("국립중앙박물관");
    expect(buddha?.licence).toContain("공공누리 제1유형");
    expect(buddha?.url).toContain("relicId=188866");
  });

  it("are complete, each with a page to visit", () => {
    for (const credit of CREDITS) {
      for (const field of [credit.title, credit.author, credit.provider, credit.licence, credit.changes]) {
        expect(field.trim()).not.toBe("");
      }
      expect(credit.url.startsWith("https://")).toBe(true);
    }
  });

  it("read as one line with the work, its author, where it is from and the licence", () => {
    for (const credit of CREDITS) {
      const line = creditLine(credit);
      expect(line).toContain(credit.title);
      expect(line).toContain(credit.author);
      expect(line).toContain(credit.provider);
      expect(line).toContain(credit.licence);
    }
  });
});
