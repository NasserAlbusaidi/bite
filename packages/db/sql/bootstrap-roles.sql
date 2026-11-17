-- Run ONCE per Postgres cluster, by a superuser (or the managed-DB admin),
-- before the first migration. Roles are cluster-wide, so they do not live
-- in migrations.
--
--   bite_app     the API and workers acting for one tenant. RLS applies.
--   bite_system  cross-tenant jobs: provisioning, webhooks, schedulers.
--
-- Both are NOLOGIN group roles. Per-environment login users get their own
-- passwords and are granted membership, e.g.
--   CREATE ROLE bite_api LOGIN PASSWORD '...' IN ROLE bite_app;
--   CREATE ROLE bite_worker LOGIN BYPASSRLS PASSWORD '...' IN ROLE bite_system;
-- Role ATTRIBUTES are not inherited through membership: a bite_system login
-- must itself be BYPASSRLS, or RLS silently hides every row from it.
-- The migration owner must not be a member of either.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bite_app') THEN
		CREATE ROLE bite_app NOLOGIN NOBYPASSRLS;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bite_system') THEN
		CREATE ROLE bite_system NOLOGIN BYPASSRLS;
	END IF;
END
$$;

-- The background worker (a bite_system login) keeps pg-boss's job tables in
-- its own `pgboss` schema, which it creates on first start. Run this part
-- in the application database.
DO $$
BEGIN
	EXECUTE format('GRANT CREATE ON DATABASE %I TO bite_system', current_database());
END
$$;
