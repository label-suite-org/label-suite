export type CampaignTemplatePlaceholder = string;

export interface CampaignTemplatePlaceholderValues {
  [placeholder: CampaignTemplatePlaceholder]: string | null | undefined;
}

export interface CampaignTemplateReviewRecord {
  templateId: string;
  tenantId: string;
  subjectTemplate: string;
  bodyTemplate: string;
  reviewedAt: string | null;
  currentVersion: number;
  reviewedVersion: number | null;
}

export interface CampaignTemplateSourceRecord {
  tenantId: string;
  templateId: string;
  sourceVersion: number;
  stale: boolean;
}

export type CampaignTemplateBlockerCode =
  | "tenant_mismatch"
  | "template_missing"
  | "template_unreviewed"
  | "version_mismatch"
  | "source_missing"
  | "source_tenant_mismatch"
  | "source_version_mismatch"
  | "source_stale"
  | "placeholder_missing";

export interface CampaignTemplateBlocker {
  code: CampaignTemplateBlockerCode;
  message: string;
}

export interface CampaignTemplateValidationResult {
  isValid: boolean;
  blockers: CampaignTemplateBlocker[];
}

export interface CampaignTemplatePlaceholderResolution {
  renderedText: string;
  missingPlaceholders: CampaignTemplatePlaceholder[];
}

export interface CampaignTemplatePreview {
  templateId: string;
  subject: string;
  body: string;
  missingPlaceholders: CampaignTemplatePlaceholder[];
}

export interface CampaignTemplateNoSendResult {
  canSend: false;
  status: "no-send";
  tenantId: string;
  templateId: string | null;
  blockers: CampaignTemplateBlocker[];
}

export interface CampaignTemplateSendResult {
  canSend: true;
  status: "ready";
  tenantId: string;
  templateId: string;
  blockers: [];
  preview: CampaignTemplatePreview;
}

export type CampaignTemplateSendDecision = CampaignTemplateNoSendResult | CampaignTemplateSendResult;

const TEMPLATE_PLACEHOLDER = /\{\{(\w+)\}\}/g;

export interface CampaignTemplateValidationInput {
  tenantId: string;
  template: CampaignTemplateReviewRecord | null;
  source: CampaignTemplateSourceRecord | null;
}

export interface CampaignTemplatePreviewInput {
  tenantId: string;
  template: CampaignTemplateReviewRecord;
  placeholderValues: CampaignTemplatePlaceholderValues;
}

export interface CampaignTemplateEvaluationInput extends CampaignTemplateValidationInput {
  placeholderValues: CampaignTemplatePlaceholderValues;
}

export function resolveTemplatePlaceholders(
  template: string,
  values: CampaignTemplatePlaceholderValues,
): CampaignTemplatePlaceholderResolution {
  const missing = new Set<CampaignTemplatePlaceholder>();

  const renderedText = template.replace(TEMPLATE_PLACEHOLDER, (match, key: CampaignTemplatePlaceholder) => {
    const value = values[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      missing.add(key);
      return match;
    }

    return value;
  });

  return {
    renderedText,
    missingPlaceholders: [...missing].sort(),
  };
}

export function validateReviewedTemplate(input: CampaignTemplateValidationInput): CampaignTemplateValidationResult {
  const blockers: CampaignTemplateBlocker[] = [];

  if (!input.template) {
    return {
      isValid: false,
      blockers: [{ code: "template_missing", message: "Template not found for tenant." }],
    };
  }

  if (input.template.tenantId !== input.tenantId) {
    blockers.push({
      code: "tenant_mismatch",
      message: `Template tenant ${input.template.tenantId} does not match tenant ${input.tenantId}.`,
    });
  }

  if (input.template.reviewedAt === null) {
    blockers.push({ code: "template_unreviewed", message: "Template has not been reviewed." });
  }

  if (input.template.reviewedVersion === null || input.template.reviewedVersion !== input.template.currentVersion) {
    blockers.push({ code: "version_mismatch", message: "Template version changed after review." });
  }

  if (!input.source) {
    blockers.push({ code: "source_missing", message: "Source template is missing." });
    return { isValid: false, blockers };
  }

  if (input.source.templateId !== input.template.templateId) {
    blockers.push({
      code: "source_missing",
      message: "Source template does not match reviewed template.",
    });
  }

  if (input.source.tenantId !== input.template.tenantId) {
    blockers.push({ code: "source_tenant_mismatch", message: "Source template tenant does not match reviewed template tenant." });
  }

  if (input.source.stale) {
    blockers.push({ code: "source_stale", message: "Source template is marked stale." });
  }

  if (input.source.sourceVersion !== input.template.reviewedVersion) {
    blockers.push({ code: "source_version_mismatch", message: "Source template has changed since review." });
  }

  return {
    isValid: blockers.length === 0,
    blockers,
  };
}

export function renderCampaignTemplatePreview(input: CampaignTemplatePreviewInput): CampaignTemplatePreview {
  const subject = resolveTemplatePlaceholders(input.template.subjectTemplate, input.placeholderValues);
  const body = resolveTemplatePlaceholders(input.template.bodyTemplate, input.placeholderValues);

  return {
    templateId: input.template.templateId,
    subject: subject.renderedText,
    body: body.renderedText,
    missingPlaceholders: Array.from(new Set([...subject.missingPlaceholders, ...body.missingPlaceholders])).sort(),
  };
}

export function evaluateCampaignTemplate(input: CampaignTemplateEvaluationInput): CampaignTemplateSendDecision {
  const validation = validateReviewedTemplate(input);

  if (!validation.isValid) {
    return {
      canSend: false,
      status: "no-send",
      tenantId: input.tenantId,
      templateId: input.template?.templateId ?? null,
      blockers: validation.blockers,
    };
  }

  if (!input.template) {
    return {
      canSend: false,
      status: "no-send",
      tenantId: input.tenantId,
      templateId: null,
      blockers: [{
        code: "template_missing",
        message: "Template not found for tenant.",
      }],
    };
  }

  const template = input.template;
  const preview = renderCampaignTemplatePreview({ ...input, template });
  if (preview.missingPlaceholders.length > 0) {
    return {
      canSend: false,
      status: "no-send",
      tenantId: input.tenantId,
      templateId: preview.templateId,
      blockers: [{
        code: "placeholder_missing",
        message: `Missing source fields for placeholders: ${preview.missingPlaceholders.join(", ")}`,
      }],
    };
  }

  return {
    canSend: true,
    status: "ready",
    tenantId: input.tenantId,
    templateId: input.template.templateId,
    blockers: [],
    preview,
  };
}
