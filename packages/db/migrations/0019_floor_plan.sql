CREATE TYPE "public"."table_shape" AS ENUM('square', 'round', 'rect');--> statement-breakpoint
CREATE TABLE "floor_areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floor_areas_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "floor_areas_name_len" CHECK (char_length("floor_areas"."name") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "floor_areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "floor_tables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"label" text NOT NULL,
	"seats" smallint DEFAULT 4 NOT NULL,
	"shape" "table_shape" DEFAULT 'square' NOT NULL,
	"x" smallint DEFAULT 0 NOT NULL,
	"y" smallint DEFAULT 0 NOT NULL,
	"w" smallint DEFAULT 2 NOT NULL,
	"h" smallint DEFAULT 2 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"server_member_id" uuid,
	"server_assigned_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floor_tables_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "floor_tables_label_uq" UNIQUE("location_id","label"),
	CONSTRAINT "floor_tables_label_len" CHECK (char_length("floor_tables"."label") between 1 and 20),
	CONSTRAINT "floor_tables_seats" CHECK ("floor_tables"."seats" between 1 and 40),
	CONSTRAINT "floor_tables_geometry" CHECK ("floor_tables"."x" between 0 and 200 and "floor_tables"."y" between 0 and 200 and "floor_tables"."w" between 1 and 20 and "floor_tables"."h" between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "floor_tables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "floor_areas" ADD CONSTRAINT "floor_areas_org_id_location_id_locations_org_id_id_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_tables" ADD CONSTRAINT "floor_tables_org_id_location_id_locations_org_id_id_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_tables" ADD CONSTRAINT "floor_tables_org_id_area_id_floor_areas_org_id_id_fk" FOREIGN KEY ("org_id","area_id") REFERENCES "public"."floor_areas"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_tables" ADD CONSTRAINT "floor_tables_org_id_server_member_id_members_org_id_id_fk" FOREIGN KEY ("org_id","server_member_id") REFERENCES "public"."members"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "floor_areas_location_idx" ON "floor_areas" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "floor_tables_location_idx" ON "floor_tables" USING btree ("location_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "floor_areas" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "floor_tables" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());