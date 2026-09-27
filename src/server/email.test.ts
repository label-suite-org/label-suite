import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getCampaignEmailProvider,
  sendEmailViaBrevo,
  queuePasswordResetEmail,
  sendPasswordResetEmail,
  sendWorkspaceInvitationEmail,
} from "./email";

describe("campaign email provider boundary", () => {
  test("keeps Brevo as the explicit configured provider", () => {
    expect(getCampaignEmailProvider().id).toBe("brevo");
  });
});

describe("workspace invitation email", () => {
  test("requires a configured sender before contacting the email provider", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("BREVO_SENDER_EMAIL", undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendEmailViaBrevo({ subject: "Test", htmlBody: "Test", toEmail: "recipient@example.test" }))
      .rejects.toThrow("BREVO_SENDER_EMAIL or an explicit senderEmail is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("sends one escaped acceptance link with inviter, workspace, and expiry copy", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("BREVO_SENDER_EMAIL", "sender@example.test");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ messageId: "message-1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendWorkspaceInvitationEmail({
      toEmail: "julie@example.com",
      inviterName: "Malthe <Owner>",
      workspaceName: "True & Nature",
      acceptUrl: "https://labels.example.com/invite/a&b?<token>",
    })).resolves.toEqual({ messageId: "message-1", status: "sent" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.subject).toContain("True & Nature");
    expect(body.htmlContent).toContain("Malthe &lt;Owner&gt;");
    expect(body.htmlContent).toContain("True &amp; Nature");
    expect(body.htmlContent).toContain("seven days");
    expect(body.htmlContent.match(/https:\/\/labels\.example\.com\/invite\//g)).toHaveLength(1);
    expect(body.htmlContent).toContain("a&amp;b?&lt;token&gt;");
    expect(body.htmlContent).not.toContain("a&b?<token>");
  });

  test("returns the existing Brevo failure status", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("BREVO_SENDER_EMAIL", "sender@example.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("provider error", { status: 500 })));
    await expect(sendWorkspaceInvitationEmail({
      toEmail: "julie@example.com", inviterName: "Malthe", workspaceName: "True Nature", acceptUrl: "https://example.com/token",
    })).resolves.toMatchObject({ status: "failed", messageId: "" });
  });
});

describe("password reset email", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("sends an escaped link without printing the raw URL or token", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("BREVO_SENDER_EMAIL", "sender@example.test");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ messageId: "reset-1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const resetUrl = 'https://labels.example.com/reset?token=<secret>&next="login"';
    await expect(sendPasswordResetEmail({
      toEmail: "user@example.com",
      resetUrl,
    })).resolves.toEqual({ messageId: "reset-1", status: "sent" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.to).toEqual([{ email: "user@example.com", name: "user@example.com" }]);
    expect(body.htmlContent).toContain("Reset password</a>");
    expect(body.htmlContent).toContain("token=&lt;secret&gt;&amp;next=&quot;login&quot;");
    expect(body.htmlContent).not.toContain(resetUrl);
    expect(body.htmlContent.match(/https:\/\/labels\.example\.com\/reset/g)).toHaveLength(1);
  });

  test("contains asynchronous provider failures instead of rejecting the auth request", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("BREVO_SENDER_EMAIL", "sender@example.test");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("provider offline");
    }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => queuePasswordResetEmail({
      toEmail: "user@example.com",
      resetUrl: "https://labels.example.com/reset?token=secret",
    })).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consoleError).toHaveBeenCalledWith(
      "Password reset email delivery failed",
      { provider: "brevo" },
    );
  });
});
