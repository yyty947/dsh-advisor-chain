import { describe, expect, it } from "vitest";
import { detectLanguage, HOST_MESSAGES, resolveLanguage, t, type Lang } from "../src/i18n";

describe("host dictionaries", () => {
  const langs = Object.keys(HOST_MESSAGES) as Lang[];
  for (const lang of langs) {
    it(`${lang}: every placeholder in the Chinese source is preserved and every template renders`, () => {
      const zh = HOST_MESSAGES.zh as Record<string, string>;
      const dict = HOST_MESSAGES[lang] as Record<string, string>;
      expect(Object.keys(dict).sort()).toEqual(Object.keys(zh).sort());
      for (const [key, template] of Object.entries(dict)) {
        const source = zh[key];
        const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect(names(template), key).toEqual(names(source));
        // Rendering with every placeholder filled leaves no brace behind.
        const params = Object.fromEntries(names(template).map((n) => [n, "X"]));
        expect(t(lang, key as keyof typeof HOST_MESSAGES.zh, params), key).not.toMatch(/\{|\}/);
      }
    });
  }
});

describe("language detection", () => {
  it("infers Chinese from CJK share and English from Latin text", () => {
    expect(detectLanguage("这个方案可行吗？")).toBe("zh");
    expect(detectLanguage("Is this plan sound?")).toBe("en");
    expect(detectLanguage("修一下 login 的问题")).toBe("zh");
    expect(detectLanguage("fix the 登录 bug")).toBe("en"); // mostly Latin
    expect(detectLanguage("继续 refactor the parser module now")).toBe("en");
    expect(detectLanguage("12345 !!!")).toBeUndefined();
  });
  it("falls back for empty text and resolves without a setting", () => {
    expect(resolveLanguage("English question")).toBe("en");
    expect(resolveLanguage("")).toBe("zh");
    expect(resolveLanguage("12345 !!!")).toBe("zh");
  });
});
