import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PasskeySettings } from "./PasskeySettings";

describe("PasskeySettings", () => {
  it("exposes authenticated passkey registration and management copy", () => {
    const html = renderToStaticMarkup(<PasskeySettings />);
    expect(html).toContain("Passkeys");
    expect(html).toContain("Add passkey");
    expect(html).toContain("Loading passkeys");
    expect(html).not.toContain("publicKey");
    expect(html).not.toContain("credentialID");
  });
});
