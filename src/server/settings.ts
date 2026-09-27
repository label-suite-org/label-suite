import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isrc_sequences, orgs } from "../db/schema";
import {
  buildIsrcPrefix,
  deriveWorkspaceIsrcConfig,
  formatIsrc,
  normalizeIsrcCountryCode,
  normalizeIsrcRegistrantCode,
} from "../lib/isrc";
import { db } from "../lib/db";
import { HttpError, NotFoundError } from "./errors";
import { resequenceCatalogEntries } from "./catalog";
import { hasOwn, nullableInteger, nullableText } from "./validation";

type DbClient = Pick<typeof db, "select" | "insert" | "update">;

const currentYear = new Date().getFullYear();

export const getWorkspaceSettingsQuerySchema = z.object({
  sequenceYear: z.coerce.number().int().min(1900).max(9999).optional(),
});

export const updateWorkspaceSettingsSchema = z
  .object({
    name: z.string().trim().min(1, "Workspace name is required").max(120).optional(),
    legal_name: nullableText,
    timezone: nullableText,
    currency: nullableText,
    validation_sweep_mode: z.enum(["manual", "scheduled", "post_write"]).optional(),
    default_release_policy: z.enum(["readiness_gates", "flexible"]).optional(),
    catalog_prefix: z.string().trim().min(1).max(16).regex(/^[a-z0-9_-]+$/i).transform((value) => value.toUpperCase()).optional(),
    catalog_number_width: z.number().int().min(1).max(12).optional(),
    isrc_country_code: nullableText,
    isrc_registrant_code: nullableText,
    sequence_year: nullableInteger({ min: 1900, max: 9999 }),
    sequence_last_production_number: nullableInteger({ min: 0, max: 99999 }),
  })
  .superRefine((value, ctx) => {
    const hasCountry = value.isrc_country_code !== undefined;
    const hasRegistrant = value.isrc_registrant_code !== undefined;

    if (hasCountry || hasRegistrant) {
      const normalizedCountry = normalizeIsrcCountryCode(value.isrc_country_code ?? null);
      const normalizedRegistrant = normalizeIsrcRegistrantCode(value.isrc_registrant_code ?? null);
      const clearingBoth = value.isrc_country_code === null && value.isrc_registrant_code === null;

      if (!clearingBoth && (!normalizedCountry || !normalizedRegistrant)) {
        ctx.addIssue({
          code: "custom",
          path: ["isrc_country_code"],
          message: "ISRC country code must be 2 letters and registrant code must be 3 letters/numbers",
        });
      }
    }

    const hasSequenceYear = value.sequence_year !== undefined;
    const hasSequenceLast = value.sequence_last_production_number !== undefined;

    if (hasSequenceYear !== hasSequenceLast) {
      ctx.addIssue({
        code: "custom",
        path: ["sequence_year"],
        message: "Sequence year and last assigned designation must be saved together",
      });
    }
  });

export const generateIsrcSchema = z.object({
  year: z.number().int().min(1900).max(9999).optional(),
});

export async function getWorkspaceSettings(
  orgId: string,
  sequenceYear = currentYear,
  client: DbClient = db,
) {
  const orgRow = (
    await client
      .select({
        id: orgs.id,
        name: orgs.name,
        legal_name: orgs.legal_name,
        timezone: orgs.timezone,
        currency: orgs.currency,
        validation_sweep_mode: orgs.validation_sweep_mode,
        default_release_policy: orgs.default_release_policy,
        catalog_prefix: orgs.catalog_prefix,
        catalog_number_width: orgs.catalog_number_width,
        isrc_country_code: orgs.isrc_country_code,
        isrc_registrant_code: orgs.isrc_registrant_code,
      })
      .from(orgs)
      .where(eq(orgs.id, orgId))
  )[0];

  if (!orgRow) {
    throw new NotFoundError("Workspace not found");
  }

  const sequenceRow = (
    await client
      .select({
        lastProductionNumber: isrc_sequences.last_production_number,
        prefix: isrc_sequences.prefix,
      })
      .from(isrc_sequences)
      .where(and(eq(isrc_sequences.org_id, orgId), eq(isrc_sequences.year, sequenceYear)))
  )[0];

  const config = deriveWorkspaceIsrcConfig(orgId, orgRow);
  const fallbackCountry = config?.countryCode ?? null;
  const fallbackRegistrant = config?.registrantCode ?? null;
  const prefix = config?.prefix ?? null;
  const lastProductionNumber = sequenceRow?.lastProductionNumber ?? 0;

  return {
    name: orgRow.name,
    legal_name: orgRow.legal_name ?? null,
    timezone: orgRow.timezone ?? "Europe/Copenhagen",
    currency: orgRow.currency ?? "DKK",
    validation_sweep_mode: orgRow.validation_sweep_mode ?? "manual",
    default_release_policy: orgRow.default_release_policy ?? "readiness_gates",
    catalog_prefix: orgRow.catalog_prefix ?? "CAT",
    catalog_number_width: orgRow.catalog_number_width ?? 3,
    isrc_country_code: orgRow.isrc_country_code ?? fallbackCountry,
    isrc_registrant_code: orgRow.isrc_registrant_code ?? fallbackRegistrant,
    isrc_prefix: prefix,
    isrc_config_source: config?.source ?? "missing",
    sequence_year: sequenceYear,
    sequence_last_production_number: lastProductionNumber,
    next_isrc_preview: prefix ? formatIsrc(prefix, sequenceYear, lastProductionNumber + 1) : null,
    sequence_prefix: sequenceRow?.prefix ?? prefix,
  };
}

export async function updateWorkspaceSettings(
  orgId: string,
  input: z.infer<typeof updateWorkspaceSettingsSchema>,
) {
  return db.transaction(async (tx) => {
    const existing = (
      await tx
        .select({
          id: orgs.id,
          name: orgs.name,
          legal_name: orgs.legal_name,
          timezone: orgs.timezone,
          currency: orgs.currency,
          validation_sweep_mode: orgs.validation_sweep_mode,
          default_release_policy: orgs.default_release_policy,
          catalog_prefix: orgs.catalog_prefix,
          catalog_number_width: orgs.catalog_number_width,
          isrc_country_code: orgs.isrc_country_code,
          isrc_registrant_code: orgs.isrc_registrant_code,
        })
        .from(orgs)
        .where(eq(orgs.id, orgId))
    )[0];

    if (!existing) {
      throw new NotFoundError("Workspace not found");
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (hasOwn(input, "name")) updates.name = input.name;
    if (hasOwn(input, "legal_name")) updates.legal_name = input.legal_name;
    if (hasOwn(input, "timezone")) updates.timezone = input.timezone ?? "Europe/Copenhagen";
    if (hasOwn(input, "currency")) updates.currency = input.currency?.toUpperCase() ?? "DKK";
    if (hasOwn(input, "validation_sweep_mode")) updates.validation_sweep_mode = input.validation_sweep_mode;
    if (hasOwn(input, "default_release_policy")) updates.default_release_policy = input.default_release_policy;
    if (hasOwn(input, "catalog_prefix")) updates.catalog_prefix = input.catalog_prefix;
    if (hasOwn(input, "catalog_number_width")) updates.catalog_number_width = input.catalog_number_width;

    const mergedCountryCode = hasOwn(input, "isrc_country_code")
      ? normalizeIsrcCountryCode(input.isrc_country_code ?? null)
      : normalizeIsrcCountryCode(existing.isrc_country_code);
    const mergedRegistrantCode = hasOwn(input, "isrc_registrant_code")
      ? normalizeIsrcRegistrantCode(input.isrc_registrant_code ?? null)
      : normalizeIsrcRegistrantCode(existing.isrc_registrant_code);
    const clearingIsrcConfig = input.isrc_country_code === null && input.isrc_registrant_code === null;

    if (hasOwn(input, "isrc_country_code") || hasOwn(input, "isrc_registrant_code")) {
      updates.isrc_country_code = clearingIsrcConfig ? null : mergedCountryCode;
      updates.isrc_registrant_code = clearingIsrcConfig ? null : mergedRegistrantCode;
    }

    await tx.update(orgs).set(updates).where(eq(orgs.id, orgId));
    await resequenceCatalogEntries(tx, orgId);

    if (input.sequence_year != null && input.sequence_last_production_number != null) {
      const config = deriveWorkspaceIsrcConfig(orgId, {
        isrc_country_code: clearingIsrcConfig
          ? null
          : (updates.isrc_country_code as string | null | undefined) ?? existing.isrc_country_code,
        isrc_registrant_code: clearingIsrcConfig
          ? null
          : (updates.isrc_registrant_code as string | null | undefined) ?? existing.isrc_registrant_code,
      });

      if (!config) {
        throw new HttpError("Configure the workspace ISRC country and registrant codes before saving sequence values", 400);
      }

      await tx
        .insert(isrc_sequences)
        .values({
          id: crypto.randomUUID(),
          org_id: orgId,
          year: input.sequence_year,
          last_production_number: input.sequence_last_production_number,
          prefix: buildIsrcPrefix(config.countryCode, config.registrantCode),
        })
        .onConflictDoUpdate({
          target: [isrc_sequences.org_id, isrc_sequences.year],
          set: {
            last_production_number: input.sequence_last_production_number,
            prefix: buildIsrcPrefix(config.countryCode, config.registrantCode),
          },
        });
    }

    return getWorkspaceSettings(orgId, input.sequence_year ?? currentYear, tx);
  });
}
