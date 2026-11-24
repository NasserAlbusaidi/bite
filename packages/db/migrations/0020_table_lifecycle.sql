ALTER TABLE "orders" ADD COLUMN "served_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "table_cleared_at" timestamp with time zone;--> statement-breakpoint
-- Orders already closed don't hold a table.
UPDATE "orders" SET "table_cleared_at" = coalesce("completed_at", "cancelled_at", "placed_at") WHERE "fulfillment_status" IN ('completed', 'cancelled') AND "table_label" IS NOT NULL;
