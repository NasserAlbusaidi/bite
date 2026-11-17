-- Back-office session -> the orgs this login belongs to. Same shape as the
-- 0004 lookups: exact match, ids only, EXECUTE only to bite_app. The caller
-- then opens withTenant() with the chosen org and reads the member under RLS.
-- Inactive members and suspended orgs resolve to nothing.
CREATE FUNCTION user_memberships(p_user_id text)
	RETURNS TABLE (org_id uuid, member_id uuid)
	LANGUAGE sql STABLE SECURITY DEFINER
	SET search_path = public, pg_temp
	AS $$
		SELECT m.org_id, m.id
		FROM members m
		JOIN orgs o ON o.id = m.org_id
		WHERE m.user_id = p_user_id
			AND m.is_active
			AND o.status <> 'suspended'
		ORDER BY m.created_at
	$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION user_memberships(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION user_memberships(text) TO bite_app;
--> statement-breakpoint
-- webhook_events has no RLS (tenant unknown on arrival) and is documented as
-- system-only, but the default privileges from 0000 granted it to bite_app too.
REVOKE ALL ON TABLE webhook_events FROM bite_app;
