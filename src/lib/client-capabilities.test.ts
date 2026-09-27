import { describe, expect, it } from "vitest";
import * as clientCapabilities from "./client-capabilities";
import { ROLE_CAPABILITIES, serializeClientCapabilities } from "../server/tenant";

describe("serializeClientCapabilities", () => {
  it("allows fundraisers to edit the approved operating domains", () => {
    const capabilities = serializeClientCapabilities("fundraiser");

    expect(capabilities["projects.mutate"]).toBe(true);
    expect(capabilities["budgets.mutate"]).toBe(true);
    expect(capabilities["fundraising.mutate"]).toBe(true);
    expect(capabilities["contacts.mutate"]).toBe(true);
    expect(capabilities["grant_documents.mutate"]).toBe(true);
  });

  it("denies fundraisers generic workspace and decision operations", () => {
    const capabilities = serializeClientCapabilities("fundraiser");

    expect(capabilities["workspace.manage_members"]).toBe(false);
    expect(capabilities["workspace.manage_settings"]).toBe(false);
    expect(capabilities["variance.decide"]).toBe(false);
    expect(capabilities["operations.mutate"]).toBe(false);
  });

  it("returns a complete serializable map for every role", () => {
    const capabilities = serializeClientCapabilities("owner");

    expect(Object.keys(capabilities)).toEqual(ROLE_CAPABILITIES.owner);
    expect(JSON.parse(JSON.stringify(capabilities))).toEqual(capabilities);
    expect(Object.values(capabilities).every(Boolean)).toBe(true);
  });

  it("keeps role policy out of the client module", () => {
    expect(clientCapabilities).not.toHaveProperty("clientCapabilitiesFor");
    expect(clientCapabilities).not.toHaveProperty("CLIENT_CAPABILITIES");
  });
});
