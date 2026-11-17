-- Realtime hints. One channel, filtered per tenant/location in the API.
-- NOTIFY is transactional: listeners only hear about committed changes.
-- Payloads carry ids and statuses only (no names, no money): they are
-- hints that tell clients to pull.
CREATE FUNCTION bite_notify_order() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	PERFORM pg_notify('bite_events', json_build_object(
		'type', 'order.changed',
		'org', NEW.org_id,
		'loc', NEW.location_id,
		'orderId', NEW.id,
		'version', NEW.version,
		'paymentStatus', NEW.payment_status,
		'fulfillmentStatus', NEW.fulfillment_status
	)::text);
	RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER orders_notify
	AFTER INSERT OR UPDATE ON orders
	FOR EACH ROW EXECUTE FUNCTION bite_notify_order();
--> statement-breakpoint
-- Any menu edit. Org-wide except per-location overrides; the API collapses
-- bursts (a bulk edit touching 200 rows sends one event per client).
CREATE FUNCTION bite_notify_menu() RETURNS trigger
	LANGUAGE plpgsql AS $$
DECLARE
	r record;
BEGIN
	IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
	PERFORM pg_notify('bite_events', json_build_object(
		'type', 'menu.changed',
		'org', r.org_id,
		-- Only product_location_settings has a location_id; elsewhere this is null.
		'loc', to_jsonb(r) ->> 'location_id'
	)::text);
	RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER categories_notify AFTER INSERT OR UPDATE OR DELETE ON categories
	FOR EACH ROW EXECUTE FUNCTION bite_notify_menu();
--> statement-breakpoint
CREATE TRIGGER products_notify AFTER INSERT OR UPDATE OR DELETE ON products
	FOR EACH ROW EXECUTE FUNCTION bite_notify_menu();
--> statement-breakpoint
CREATE TRIGGER pls_notify AFTER INSERT OR UPDATE OR DELETE ON product_location_settings
	FOR EACH ROW EXECUTE FUNCTION bite_notify_menu();
--> statement-breakpoint
CREATE TRIGGER modifier_groups_notify AFTER INSERT OR UPDATE OR DELETE ON modifier_groups
	FOR EACH ROW EXECUTE FUNCTION bite_notify_menu();
--> statement-breakpoint
CREATE TRIGGER modifier_options_notify AFTER INSERT OR UPDATE OR DELETE ON modifier_options
	FOR EACH ROW EXECUTE FUNCTION bite_notify_menu();
--> statement-breakpoint
CREATE TRIGGER product_modifier_groups_notify AFTER INSERT OR UPDATE OR DELETE ON product_modifier_groups
	FOR EACH ROW EXECUTE FUNCTION bite_notify_menu();
--> statement-breakpoint
CREATE TRIGGER promotions_notify AFTER INSERT OR UPDATE OR DELETE ON promotions
	FOR EACH ROW EXECUTE FUNCTION bite_notify_menu();
--> statement-breakpoint
CREATE FUNCTION bite_notify_device() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
		PERFORM pg_notify('bite_events', json_build_object(
			'type', 'device.revoked',
			'org', NEW.org_id,
			'loc', NEW.location_id,
			'deviceId', NEW.id
		)::text);
	END IF;
	RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER devices_notify AFTER UPDATE ON devices
	FOR EACH ROW EXECUTE FUNCTION bite_notify_device();
