CREATE TABLE "member_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "member_invites_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "member_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "orders_paused_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member_invites" ADD CONSTRAINT "member_invites_org_id_member_id_members_org_id_id_fk" FOREIGN KEY ("org_id","member_id") REFERENCES "public"."members"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_invites_open_uq" ON "member_invites" USING btree ("member_id") WHERE "member_invites"."accepted_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "member_invites" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());