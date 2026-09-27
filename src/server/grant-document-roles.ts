import { z } from "zod";

/** Evidence roles accepted by both the supporting-document API and workspace replacement API. */
export const GRANT_DOCUMENT_ROLES = ["submitted_application", "award_decision", "expense_documentation", "other"] as const;
export const grantDocumentRoleSchema = z.enum(GRANT_DOCUMENT_ROLES);
export type GrantDocumentRole = typeof GRANT_DOCUMENT_ROLES[number];
