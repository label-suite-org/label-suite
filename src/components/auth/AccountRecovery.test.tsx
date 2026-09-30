import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginForm } from "./LoginForm";
import { ResetPasswordForm } from "./ResetPasswordForm";

describe("account recovery and passkey entry points", () => {
  it("offers password, passkey, and recovery sign-in paths", () => {
    const html = renderToStaticMarkup(<LoginForm ssoEnabled />);
    expect(html).toContain("Continue with Pocket ID");
    expect(html).toContain("Use a passkey");
    expect(html).toContain("Forgot password?");
    expect(html).toContain('autoComplete="username webauthn"');
    expect(html).toContain('autoComplete="current-password"');
  });

  it("renders the compact landing form without unavailable SSO or repeated sign-in copy", () => {
    const html = renderToStaticMarkup(<LoginForm />);
    expect(html).not.toContain("Continue with Pocket ID");
    expect(html).not.toContain("Sign in to continue");
    expect(html).toContain(">Suite</h1>");
    expect(html.match(/>Sign in</g)).toHaveLength(1);
    expect(html).toContain('href="/signup"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
  });

  it("fails closed when a reset token is missing", () => {
    const html = renderToStaticMarkup(<ResetPasswordForm token={null} />);
    expect(html).toContain("Choose a new password");
    expect(html).toContain("disabled");
    expect(html).toContain("Back to sign in");
  });

  it("does not expose callback error details", () => {
    const html = renderToStaticMarkup(
      <ResetPasswordForm token={null} callbackError="TOKEN_EXPIRED_PRIVATE_DETAIL" />,
    );
    expect(html).toContain("invalid or has expired");
    expect(html).not.toContain("TOKEN_EXPIRED_PRIVATE_DETAIL");
  });
});
