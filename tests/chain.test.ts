import { describe, expect, it } from "vitest";
import { entryName } from "../src/chain";

describe("entryName", () => {
  it("prefers a non-blank label and falls back to provider/model", () => {
    expect(entryName({ label: "架构顾问", provider: "z-ai", model: "glm-5.4" })).toBe("架构顾问");
    expect(entryName({ label: "  ", provider: "z-ai", model: "glm-5.4" })).toBe("z-ai/glm-5.4");
    expect(entryName({ provider: "deepseek-official", model: "deepseek-flash" })).toBe("deepseek-official/deepseek-flash");
  });
});
