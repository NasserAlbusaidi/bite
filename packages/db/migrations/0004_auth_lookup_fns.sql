-- Entry points that must resolve a tenant BEFORE a tenant context exists.
-- bite_app cannot read devices/locations without app.org_id set (RLS), so
-- these SECURITY DEFINER functions (owned by the migration owner, which is
-- exempt from RLS) return the minimum needed to set the context. Keep them
-- narrow: exact-match lookups only, no secrets returned, EXECUTE only to bite_app.

-- Device bearer token -> device + tenant. Revoked devices, inactive
-- locations and suspended orgs resolve to nothing.
CREATE FUNCTION auth_device(p_token_hash text)
	RETURNS TABLE (
		device_id uuid,
		org_id uuid,
		location_id uuid,
		kind device_kind,
		ticket_prefix text,
		name text
	)
	LANGUAGE sql STABLE SECURITY DEFINER
	SET search_path = public, pg_temp
	AS $$
		SELECT d.id, d.org_id, d.location_id, d.kind, d.ticket_prefix, d.name
		FROM devices d
		JOIN locations l ON l.id = d.location_id AND l.org_id = d.org_id
		JOIN orgs o ON o.id = d.org_id
		WHERE d.token_hash = p_token_hash
			AND d.revoked_at IS NULL
			AND l.is_active
			AND o.status <> 'suspended'
	$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_device(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_device(text) TO bite_app;
--> statement-breakpoint
-- Guest menu slug -> tenant. Public by nature (the slug is in the QR code).
CREATE FUNCTION resolve_location_slug(p_slug text)
	RETURNS TABLE (org_id uuid, location_id uuid)
	LANGUAGE sql STABLE SECURITY DEFINER
	SET search_path = public, pg_temp
	AS $$
		SELECT l.org_id, l.id
		FROM locations l
		JOIN orgs o ON o.id = l.org_id
		WHERE l.slug = p_slug
			AND l.is_active
			AND o.status <> 'suspended'
	$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_location_slug(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_location_slug(text) TO bite_app;
--> statement-breakpoint
-- Guest tracking link -> tenant + order. The token is an unguessable uuid.
CREATE FUNCTION resolve_tracking_token(p_token uuid)
	RETURNS TABLE (org_id uuid, order_id uuid)
	LANGUAGE sql STABLE SECURITY DEFINER
	SET search_path = public, pg_temp
	AS $$ SELECT o.org_id, o.id FROM orders o WHERE o.tracking_token = p_token $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_tracking_token(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_tracking_token(uuid) TO bite_app;
--> statement-breakpoint
-- Group cart share link -> tenant + cart.
CREATE FUNCTION resolve_group_cart_token(p_token uuid)
	RETURNS TABLE (org_id uuid, cart_id uuid, location_id uuid)
	LANGUAGE sql STABLE SECURITY DEFINER
	SET search_path = public, pg_temp
	AS $$ SELECT c.org_id, c.id, c.location_id FROM group_carts c WHERE c.token = p_token $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_group_cart_token(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_group_cart_token(uuid) TO bite_app;
