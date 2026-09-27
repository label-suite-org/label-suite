export const INVITATION_CONTINUATION_COOKIE = "label_suite_invitation";
export const INVITATION_CONTINUATION_MAX_AGE = 15 * 60;

export function invitationCookieOptions(url: URL) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: url.protocol === "https:",
    path: "/",
    maxAge: INVITATION_CONTINUATION_MAX_AGE,
  };
}

export function clearInvitationCookie(cookies: { delete(name: string, options: { path: string }): void }) {
  cookies.delete(INVITATION_CONTINUATION_COOKIE, { path: "/" });
}
