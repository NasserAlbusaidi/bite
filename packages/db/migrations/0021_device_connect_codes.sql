ALTER TABLE "devices" ADD COLUMN "pairing_code_hash" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "pairing_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_pairing_code_hash_unique" UNIQUE("pairing_code_hash");--> statement-breakpoint
-- Connect code -> device, for a tablet that has no token yet (POST /v1/pair).
-- Same rules as auth_device: revoked devices, inactive locations and
-- suspended orgs get nothing. Works once: the row gets the caller's new token
-- hash and the code is cleared in the same statement, so two tablets racing
-- with one code can't both win. Expired codes match nothing.
CREATE FUNCTION redeem_device_code(p_code_hash text, p_token_hash text)
	RETURNS TABLE (
		device_id uuid,
		org_id uuid,
		location_id uuid,
		kind device_kind,
		ticket_prefix text,
		name text
	)
	LANGUAGE sql VOLATILE SECURITY DEFINER
	SET search_path = public, pg_temp
	AS $$
		UPDATE devices d
		SET token_hash = p_token_hash,
			pairing_code_hash = NULL,
			pairing_expires_at = NULL,
			last_seen_at = now(),
			updated_at = now()
		FROM locations l, orgs o
		WHERE d.pairing_code_hash = p_code_hash
			AND d.pairing_expires_at > now()
			AND d.revoked_at IS NULL
			AND l.id = d.location_id AND l.org_id = d.org_id AND l.is_active
			AND o.id = d.org_id AND o.status <> 'suspended'
		RETURNING d.id, d.org_id, d.location_id, d.kind, d.ticket_prefix, d.name
	$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION redeem_device_code(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION redeem_device_code(text, text) TO bite_app;
