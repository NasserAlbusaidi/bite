-- audit_log is append-only for the app: RLS has no UPDATE/DELETE policy,
-- and the privileges are revoked too so attempts error instead of silently
-- matching zero rows.
REVOKE UPDATE, DELETE ON "audit_log" FROM bite_app;
--> statement-breakpoint
-- Webhook intake and dedupe is cross-tenant: system role only.
REVOKE ALL ON "webhook_events" FROM bite_app;
