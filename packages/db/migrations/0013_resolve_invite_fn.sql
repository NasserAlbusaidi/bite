-- Invite link -> tenant + invite. Same rules as 0004: exact match on the
-- token hash, ids only, EXECUTE only to bite_app. Expired, accepted and
-- suspended-org invites resolve to nothing; the caller re-checks under RLS.
CREATE FUNCTION resolve_invite(p_token_hash text)
	RETURNS TABLE (org_id uuid, invite_id uuid)
	LANGUAGE sql STABLE SECURITY DEFINER
	SET search_path = public, pg_temp
	AS $$
		SELECT i.org_id, i.id
		FROM member_invites i
		JOIN orgs o ON o.id = i.org_id
		WHERE i.token_hash = p_token_hash
			AND i.accepted_at IS NULL
			AND i.expires_at > now()
			AND o.status <> 'suspended'
	$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_invite(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_invite(text) TO bite_app;
