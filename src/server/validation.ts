import { z } from "zod";

export const idSchema = z.string().trim().min(1, "ID is required");
export const requiredText = z.string().trim().min(1);

export const nullableText = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length ? trimmed : null;
    }
    return value;
  },
  z.string().nullable().optional(),
);

export function nullableInteger(options: { min?: number; max?: number } = {}) {
  let schema = z.number().int();
  if (options.min !== undefined) schema = schema.min(options.min);
  if (options.max !== undefined) schema = schema.max(options.max);

  return z.preprocess(
    (value) => {
      if (value === undefined) return undefined;
      if (value === null || value === "") return null;
      return Number(value);
    },
    schema.nullable().optional(),
  );
}

export function nullableNumber(options: { min?: number; max?: number } = {}) {
  let schema = z.number();
  if (options.min !== undefined) schema = schema.min(options.min);
  if (options.max !== undefined) schema = schema.max(options.max);

  return z.preprocess(
    (value) => {
      if (value === undefined) return undefined;
      if (value === null || value === "") return null;
      return Number(value);
    },
    schema.nullable().optional(),
  );
}

export const optionalBoolean = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  },
  z.boolean().optional(),
);

export function hasOwn<T extends object, K extends PropertyKey>(
  object: T,
  key: K,
): object is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(object, key);
}
