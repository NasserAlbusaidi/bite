-- Roles bite_app / bite_system are created by sql/bootstrap-roles.sql
-- (cluster-wide, run once by an admin). This migration only grants to them.
-- Current tenant for this transaction, or NULL when unset. Policies compare
-- org_id = app_org_id(), and NULL never matches, so a forgotten tenant
-- context fails closed (zero rows) instead of open.
CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid
	LANGUAGE sql STABLE
	AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO bite_app, bite_system;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
	GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bite_app, bite_system;
