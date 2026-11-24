ALTER TYPE "public"."payment_method" ADD VALUE 'loyalty';--> statement-breakpoint
CREATE TABLE "customer_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "customer_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_id" uuid,
	"kind" text NOT NULL,
	"points" integer NOT NULL,
	"reward_id" text,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_ledger_kind" CHECK ("loyalty_ledger"."kind" in ('earn', 'redeem', 'adjust')),
	CONSTRAINT "loyalty_ledger_nonzero" CHECK ("loyalty_ledger"."points" <> 0)
);
--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "loyalty_programs" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"points_per_rial" integer DEFAULT 10 NOT NULL,
	"rewards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_points_per_rial_range" CHECK (points_per_rial between 0 and 1000)
);
--> statement-breakpoint
ALTER TABLE "loyalty_programs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_devices" ADD CONSTRAINT "customer_devices_org_id_customer_id_customers_org_id_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_org_id_customer_id_customers_org_id_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_devices_token_uq" ON "customer_devices" USING btree ("org_id","token_hash");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_customer_idx" ON "loyalty_ledger" USING btree ("org_id","customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_ledger_earn_once" ON "loyalty_ledger" USING btree ("org_id","order_id") WHERE "loyalty_ledger"."kind" = 'earn';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_devices" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_select" ON "loyalty_ledger" AS PERMISSIVE FOR SELECT TO "bite_app" USING (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "loyalty_ledger" AS PERMISSIVE FOR INSERT TO "bite_app" WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "loyalty_programs" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
-- The points ledger is append-only for the app, like audit_log: corrections
-- are new "adjust" rows, never edits.
REVOKE UPDATE, DELETE ON "loyalty_ledger" FROM bite_app;