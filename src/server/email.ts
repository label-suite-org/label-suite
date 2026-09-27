import "dotenv/config";
import { and, desc, eq } from "drizzle-orm";
import { users } from "../db/auth-schema";
import { db } from "../lib/db";
import { email_logs, email_templates, radio_stations } from "../db/schema";

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

export interface SendEmailInput {
  subject: string;
  htmlBody: string;
  toEmail: string;
  toName?: string;
  senderEmail?: string;
  senderName?: string;
}

export interface SendEmailResult {
  messageId: string;
  status: "sent" | "failed";
  error?: string;
}

export interface EmailProvider {
  readonly id: "brevo";
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

const brevoKey = () => {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error("BREVO_API_KEY is required");
  return key;
};

export async function sendEmailViaBrevo(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = brevoKey();
  const senderEmail = input.senderEmail ?? process.env.BREVO_SENDER_EMAIL;
  if (!senderEmail) throw new Error("BREVO_SENDER_EMAIL or an explicit senderEmail is required");
  const senderName = input.senderName ?? "True Nature";

  const body = {
    sender: { email: senderEmail, name: senderName },
    to: [{ email: input.toEmail, name: input.toName || input.toEmail }],
    subject: input.subject,
    htmlContent: input.htmlBody,
  };

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    return { messageId: "", status: "failed", error: `Brevo ${res.status}: ${err.slice(0, 200)}` };
  }

  const data = await res.json() as { messageId: string };
  return { messageId: data.messageId, status: "sent" };
}

/**
 * The provider boundary is deliberately small. Brevo remains the configured
 * transport until a reviewed provider ADR changes it; callers do not select a
 * provider from request data and opening a campaign never sends mail.
 */
export const brevoEmailProvider: EmailProvider = {
  id: "brevo",
  send: sendEmailViaBrevo,
};

export function getCampaignEmailProvider(): EmailProvider {
  return brevoEmailProvider;
}

export function sendEmailThroughCampaignProvider(input: SendEmailInput): Promise<SendEmailResult> {
  return getCampaignEmailProvider().send(input);
}

export interface WorkspaceInvitationEmailInput {
  toEmail: string;
  inviterName: string;
  workspaceName: string;
  acceptUrl: string;
}

export function escapeEmailHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function sendWorkspaceInvitationEmail(input: WorkspaceInvitationEmailInput): Promise<SendEmailResult> {
  const workspaceName = escapeEmailHtml(input.workspaceName);
  const inviterName = escapeEmailHtml(input.inviterName);
  const acceptUrl = escapeEmailHtml(input.acceptUrl);

  return sendEmailThroughCampaignProvider({
    toEmail: input.toEmail,
    subject: `You are invited to ${input.workspaceName}`,
    htmlBody: [
      `<p>${inviterName} invited you to join ${workspaceName}.</p>`,
      "<p>This invitation expires in seven days.</p>",
      `<p><a href="${acceptUrl}">Accept invitation</a></p>`,
    ].join(""),
  });
}

export interface PasswordResetEmailInput {
  toEmail: string;
  resetUrl: string;
}

export function sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<SendEmailResult> {
  const resetUrl = escapeEmailHtml(input.resetUrl);

  return sendEmailThroughCampaignProvider({
    toEmail: input.toEmail,
    subject: "Reset your Label Suite password",
    htmlBody: [
      "<p>We received a request to reset your Label Suite password.</p>",
      `<p><a href="${resetUrl}">Reset password</a></p>`,
      "<p>This link expires in one hour. If you did not request it, you can ignore this email.</p>",
    ].join(""),
  });
}

/**
 * Deliberately does not expose provider latency or failure to the public reset
 * endpoint. Better Auth can therefore return the same response for known and
 * unknown addresses.
 */
export function queuePasswordResetEmail(input: PasswordResetEmailInput): void {
  void sendPasswordResetEmail(input)
    .then((result) => {
      if (result.status === "failed") {
        console.error("Password reset email delivery failed", { provider: "brevo" });
      }
    })
    .catch(() => {
      console.error("Password reset email delivery failed", { provider: "brevo" });
    });
}

// Template placeholder expansion
export function expandTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ─── Email Templates ─────────────────────────────────────

export async function listEmailTemplates(orgId: string) {
  return db
    .select({
      id: email_templates.id,
      name: email_templates.name,
      subject: email_templates.subject,
      body: email_templates.body,
      description: email_templates.description,
      is_default: email_templates.is_default,
    })
    .from(email_templates)
    .where(eq(email_templates.org_id, orgId));
}

// ─── Email Logs ─────────────────────────────────────────

export async function listEmailLogsByCampaign(orgId: string, campaignId: string) {
  return db
    .select({
      id: email_logs.id,
      subject: email_logs.subject,
      status: email_logs.status,
      provider: email_logs.provider,
      operator_id: email_logs.operator_id,
      operator_name: users.name,
      operator_email: users.email,
      sender_email: email_logs.sender_email,
      error_message: email_logs.error_message,
      sent_at: email_logs.sent_at,
      station_name: radio_stations.name,
      station_email: radio_stations.email,
    })
    .from(email_logs)
    .leftJoin(radio_stations, and(
      eq(email_logs.station_id, radio_stations.id),
      eq(radio_stations.org_id, orgId),
    ))
    .leftJoin(users, eq(email_logs.operator_id, users.id))
    .where(and(
      eq(email_logs.campaign_id, campaignId),
      eq(email_logs.org_id, orgId),
    ))
    .orderBy(desc(email_logs.sent_at));
}
