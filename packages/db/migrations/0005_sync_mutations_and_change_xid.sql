CREATE TABLE "sync_mutations" (
	"id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_mutations_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "sync_mutations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_mutations" ADD CONSTRAINT "sync_mutations_org_id_device_id_devices_org_id_id_fk" FOREIGN KEY ("org_id","device_id") REFERENCES "public"."devices"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_mutations" ADD CONSTRAINT "sync_mutations_org_id_member_id_members_org_id_id_fk" FOREIGN KEY ("org_id","member_id") REFERENCES "public"."members"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_mutations_entity_idx" ON "sync_mutations" USING btree ("org_id","entity_id");--> statement-breakpoint
CREATE INDEX "sync_mutations_device_time_idx" ON "sync_mutations" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_location_change_idx" ON "orders" USING btree ("location_id","change_xid","id");--> statement-breakpoint
CREATE POLICY "tenant_select" ON "sync_mutations" AS PERMISSIVE FOR SELECT TO "bite_app" USING (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "sync_mutations" AS PERMISSIVE FOR INSERT TO "bite_app" WITH CHECK (org_id = app_org_id());