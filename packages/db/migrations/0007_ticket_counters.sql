CREATE TABLE "ticket_counters" (
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"prefix" text NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ticket_counters_location_id_business_date_prefix_pk" PRIMARY KEY("location_id","business_date","prefix")
);
--> statement-breakpoint
ALTER TABLE "ticket_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticket_counters" ADD CONSTRAINT "ticket_counters_org_id_location_id_locations_org_id_id_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ticket_counters" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());