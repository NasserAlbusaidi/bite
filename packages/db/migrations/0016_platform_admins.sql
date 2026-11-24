-- Bite's own operators (the platform console, /v1/platform). Not tenant data:
-- no org_id, no RLS. Only the system role reads or writes it, so no tenant
-- session, however buggy, can make itself a platform admin. The API checks
-- membership through its bite_system connection.
CREATE TABLE "platform_admins" (
	"user_id" text PRIMARY KEY NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_admins" FROM bite_app;
