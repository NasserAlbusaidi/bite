-- Group cart hints for the per-cart guest SSE stream. Every cart write
-- bumps group_carts.version, so one trigger on the cart row covers item
-- and participant changes too.
CREATE FUNCTION bite_notify_cart() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	PERFORM pg_notify('bite_events', json_build_object(
		'type', 'cart.changed',
		'org', NEW.org_id,
		'loc', NEW.location_id,
		'cart', NEW.id,
		'version', NEW.version,
		'status', NEW.status
	)::text);
	RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER group_carts_notify
	AFTER INSERT OR UPDATE ON group_carts
	FOR EACH ROW EXECUTE FUNCTION bite_notify_cart();
