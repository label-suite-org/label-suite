-- planned_amount is the canonical budget plan. Keep amount as a legacy compatibility
-- column until all downstream imports and exports have moved to the canonical field.
UPDATE "label_suite"."budget_line_items"
SET "planned_amount" = "amount", "updated_at" = now()
WHERE "planned_amount" IS NULL;

COMMENT ON COLUMN "label_suite"."budget_line_items"."planned_amount" IS 'Canonical planned budget amount; amount is retained as a legacy compatibility field.';
