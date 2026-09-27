import { describe, expect, it } from "vitest";
import { replaceManagedSection } from "./managed-html.js";

describe("replaceManagedSection", () => {
  it("replaces only the machine-owned section without touching surrounding manual HTML", () => {
    const existing =
      "<p>Manual owner note</p><!-- plane-sync:source:start --><p>old</p><!-- plane-sync:source:end --><p>Manual tail</p>";

    expect(replaceManagedSection(existing, "source", "<p>new</p>")).toBe(
      "<p>Manual owner note</p><!-- plane-sync:source:start --><p>new</p><!-- plane-sync:source:end --><p>Manual tail</p>",
    );
  });

  it("appends an absent machine section after manual HTML", () => {
    expect(replaceManagedSection("<p>Manual note</p>", "health", "<p>ready</p>")).toBe(
      "<p>Manual note</p><!-- plane-sync:health:start --><p>ready</p><!-- plane-sync:health:end -->",
    );
  });

  it("fails closed on duplicated, unmatched, or nested machine markers", () => {
    expect(() =>
      replaceManagedSection(
        "<!-- plane-sync:source:start --><!-- plane-sync:source:start --><!-- plane-sync:source:end --><!-- plane-sync:source:end -->",
        "source",
        "<p>new</p>",
      ),
    ).toThrow("plane_managed_section_malformed");
    expect(() => replaceManagedSection("<!-- plane-sync:source:start --><p>old</p>", "source", "<p>new</p>")).toThrow(
      "plane_managed_section_malformed",
    );
    expect(() =>
      replaceManagedSection(
        "<!-- plane-sync:source:start --><!-- plane-sync:health:start --><p>nested</p><!-- plane-sync:health:end --><!-- plane-sync:source:end -->",
        "source",
        "<p>new</p>",
      ),
    ).toThrow("plane_managed_section_malformed");
  });
});
