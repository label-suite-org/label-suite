import { describe, expect, it } from "vitest";
import { stationWebsite } from "./RadioStationManager";

describe("station Website destinations", () => {
  it("opens imported bare domains externally and preserves explicit web URLs", () => {
    expect(stationWebsite(" station.example/path ")).toBe("https://station.example/path");
    expect(stationWebsite("//station.example/path")).toBe("https://station.example/path");
    expect(stationWebsite("http://station.example/path")).toBe("http://station.example/path");
    for (const value of [null, "", "javascript:alert(1)", "data:text/html,test", "mailto:user@example.test", "https://user:password@station.example", "not a domain"]) {
      expect(stationWebsite(value)).toBeUndefined();
    }
  });
});
