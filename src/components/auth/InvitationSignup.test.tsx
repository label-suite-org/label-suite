import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignupForm } from "./SignupForm";

describe("invitation signup", () => {
  it("prefills and locks the email returned by invitation context", () => {
    const html = renderToStaticMarkup(<SignupForm continueTo="/invite/continue" lockedEmail="invitee@example.com" />);
    expect(html).toContain('value="invitee@example.com"');
    expect(html).toContain("readOnly");
  });

  it("does not expose an invited email in the neutral initial form", () => {
    const html = renderToStaticMarkup(<SignupForm continueTo="/invite/continue" />);
    expect(html).not.toContain("invitee@example.com");
    expect(html).not.toContain("readOnly");
  });
});
