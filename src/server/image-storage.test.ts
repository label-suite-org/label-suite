import { describe, expect, it } from "vitest";
import {
  imageVariantKey,
  isGeneratedImageVariant,
  isOptimizableImageKey,
} from "./image-storage";

describe("image storage variants", () => {
  it("creates deterministic variant keys without replacing the original suffix", () => {
    expect(imageVariantKey("true-nature/art/cover.jpg", 320)).toBe(
      "true-nature/art/cover.jpg.__ls_w320.webp",
    );
  });

  it("recognizes optimizable originals and excludes generated variants", () => {
    expect(isOptimizableImageKey("true-nature/art/cover.PNG")).toBe(true);
    expect(isOptimizableImageKey("true-nature/art/vector.svg")).toBe(false);
    expect(isOptimizableImageKey("true-nature/art/cover.jpg.__ls_w96.webp")).toBe(false);
    expect(isGeneratedImageVariant("true-nature/art/cover.jpg.__ls_w800.webp")).toBe(true);
  });
});
