CREATE TYPE "public"."device_kind" AS ENUM('pos', 'kds', 'kiosk');--> statement-breakpoint
CREATE TYPE "public"."location_role" AS ENUM('manager', 'cashier', 'server', 'kitchen');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('owner', 'admin', 'staff');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('trial', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."promotion_kind" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('pending', 'preparing', 'ready', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('guest', 'counter', 'group', 'kiosk');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('dine_in', 'takeaway');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'softpos', 'thawani', 'stripe', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_state" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."cash_movement_kind" AS ENUM('pay_in', 'pay_out', 'drop');--> statement-breakpoint
CREATE TYPE "public"."cash_session_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."group_cart_status" AS ENUM('open', 'locked', 'submitted', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."billing_provider" AS ENUM('stripe', 'thawani', 'manual');--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "device_kind" NOT NULL,
	"ticket_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "devices_location_id_ticket_prefix_unique" UNIQUE("location_id","ticket_prefix")
);
--> statement-breakpoint
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Muscat' NOT NULL,
	"currency_code" char(3) DEFAULT 'OMR' NOT NULL,
	"currency_decimals" smallint DEFAULT 3 NOT NULL,
	"prices_include_tax" boolean DEFAULT true NOT NULL,
	"tax_bps" integer DEFAULT 0 NOT NULL,
	"vat_number" text,
	"day_cutoff_minutes" smallint DEFAULT 240 NOT NULL,
	"address" text,
	"phone" text,
	"whatsapp_number" text,
	"business_hours" jsonb,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"receipt_header" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"legacy_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "locations_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_locations" (
	"org_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"role" "location_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_locations_member_id_location_id_unique" UNIQUE("member_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "member_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text,
	"display_name" text NOT NULL,
	"org_role" "org_role" DEFAULT 'staff' NOT NULL,
	"pin_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"legacy_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "org_status" DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"legacy_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "orgs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"legacy_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "modifier_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"min_select" smallint DEFAULT 0 NOT NULL,
	"max_select" smallint DEFAULT 1 NOT NULL,
	"legacy_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modifier_groups_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "modifier_groups_select_range" CHECK ("modifier_groups"."min_select" >= 0 and "modifier_groups"."max_select" >= "modifier_groups"."min_select" and "modifier_groups"."max_select" >= 1)
);
--> statement-breakpoint
ALTER TABLE "modifier_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "modifier_options" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"price_delta" bigint DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"legacy_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modifier_options_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "modifier_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_location_settings" (
	"org_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"price" bigint,
	"is_available" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_location_settings_product_id_location_id_pk" PRIMARY KEY("product_id","location_id"),
	CONSTRAINT "pls_price_nonneg" CHECK ("product_location_settings"."price" is null or "product_location_settings"."price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product_location_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_modifier_groups" (
	"org_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_modifier_groups_product_id_group_id_pk" PRIMARY KEY("product_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "product_modifier_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"price" bigint NOT NULL,
	"tax_bps" integer,
	"image_url" text,
	"is_visible" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"legacy_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "products_price_nonneg" CHECK ("products"."price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid,
	"name" text NOT NULL,
	"kind" "promotion_kind" NOT NULL,
	"value" integer NOT NULL,
	"product_id" uuid,
	"category_id" uuid,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"daily_start" time,
	"daily_end" time,
	"days_of_week" smallint[],
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"legacy_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_value_pos" CHECK ("promotions"."value" > 0),
	CONSTRAINT "promotions_percent_max" CHECK ("promotions"."kind" <> 'percent' or "promotions"."value" <= 10000),
	CONSTRAINT "promotions_single_target" CHECK ("promotions"."product_id" is null or "promotions"."category_id" is null),
	CONSTRAINT "promotions_daily_window" CHECK (("promotions"."daily_start" is null) = ("promotions"."daily_end" is null))
);
--> statement-breakpoint
ALTER TABLE "promotions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"points" integer DEFAULT 0 NOT NULL,
	"visit_count" integer DEFAULT 0 NOT NULL,
	"last_visit_at" timestamp with time zone,
	"favorite_product_ids" uuid[],
	"marketing_opt_in" jsonb,
	"legacy_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "customers_org_id_phone_unique" UNIQUE("org_id","phone"),
	CONSTRAINT "customers_phone_e164" CHECK ("customers"."phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "customers_points_nonneg" CHECK ("customers"."points" >= 0)
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_feedback" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_feedback_rating" CHECK ("order_feedback"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "order_feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"name" jsonb NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"list_unit_price" bigint NOT NULL,
	"promotion_id" uuid,
	"modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tax_bps" integer NOT NULL,
	"line_total" bigint NOT NULL,
	"line_discount" bigint DEFAULT 0 NOT NULL,
	"line_tax" bigint NOT NULL,
	"note" text,
	"station" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_lines_qty_pos" CHECK ("order_lines"."quantity" > 0),
	CONSTRAINT "order_lines_amounts_nonneg" CHECK ("order_lines"."unit_price" >= 0 and "order_lines"."line_total" >= 0 and "order_lines"."line_tax" >= 0 and "order_lines"."line_discount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"device_id" uuid,
	"ticket_number" text NOT NULL,
	"business_date" date NOT NULL,
	"source" "order_source" NOT NULL,
	"type" "order_type" DEFAULT 'dine_in' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL,
	"fulfillment_status" "fulfillment_status" DEFAULT 'pending' NOT NULL,
	"customer_id" uuid,
	"customer_name" text,
	"customer_phone" text,
	"note" text,
	"prices_include_tax" boolean NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"tax_total" bigint NOT NULL,
	"total" bigint NOT NULL,
	"paid_total" bigint DEFAULT 0 NOT NULL,
	"tracking_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text,
	"idempotency_fingerprint" text,
	"created_by" uuid,
	"expires_at" timestamp with time zone,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"legacy_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_tracking_token_unique" UNIQUE("tracking_token"),
	CONSTRAINT "orders_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "orders_ticket_uq" UNIQUE("location_id","business_date","ticket_number"),
	CONSTRAINT "orders_idempotency_uq" UNIQUE("org_id","idempotency_key"),
	CONSTRAINT "orders_totals_nonneg" CHECK ("orders"."subtotal" >= 0 and "orders"."discount_total" >= 0 and "orders"."tax_total" >= 0 and "orders"."total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"cash_session_id" uuid,
	"amount" bigint NOT NULL,
	"tendered" bigint,
	"tip" bigint DEFAULT 0 NOT NULL,
	"method" "payment_method" NOT NULL,
	"state" "payment_state" DEFAULT 'succeeded' NOT NULL,
	"provider" text,
	"provider_reference" text,
	"provider_data" jsonb,
	"reverses_payment_id" uuid,
	"reason" text,
	"created_by" uuid,
	"device_id" uuid,
	"business_date" date NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "payments_amount_nonzero" CHECK ("payments"."amount" <> 0),
	CONSTRAINT "payments_refund_shape" CHECK (("payments"."amount" < 0) = ("payments"."reverses_payment_id" is not null)),
	CONSTRAINT "payments_tendered_cash_only" CHECK ("payments"."tendered" is null or ("payments"."method" = 'cash' and "payments"."tendered" >= "payments"."amount")),
	CONSTRAINT "payments_cash_needs_session" CHECK ("payments"."method" <> 'cash' or "payments"."cash_session_id" is not null),
	CONSTRAINT "payments_tip_nonneg" CHECK ("payments"."tip" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"cash_session_id" uuid NOT NULL,
	"kind" "cash_movement_kind" NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_movements_amount_pos" CHECK ("cash_movements"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "cash_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"status" "cash_session_status" DEFAULT 'open' NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opening_float" bigint NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"expected_cash" bigint,
	"counted_cash" bigint,
	"count_detail" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_sessions_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "cash_sessions_float_nonneg" CHECK ("cash_sessions"."opening_float" >= 0),
	CONSTRAINT "cash_sessions_closed_shape" CHECK (("cash_sessions"."status" = 'closed') = ("cash_sessions"."closed_at" is not null and "cash_sessions"."counted_cash" is not null and "cash_sessions"."expected_cash" is not null and "cash_sessions"."closed_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "cash_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "group_cart_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"modifier_option_ids" uuid[] DEFAULT '{}' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_cart_items_qty" CHECK ("group_cart_items"."quantity" between 1 and 99)
);
--> statement-breakpoint
ALTER TABLE "group_cart_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "group_cart_participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"is_host" boolean DEFAULT false NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_cart_participants_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "group_cart_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "group_carts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" "group_cart_status" DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"order_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_carts_token_unique" UNIQUE("token"),
	CONSTRAINT "group_carts_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "group_carts_submitted_shape" CHECK (("group_carts"."status" = 'submitted') = ("group_carts"."order_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "group_carts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid,
	"actor_member_id" uuid,
	"actor_device_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscriptions_provider_provider_subscription_id_unique" UNIQUE("provider","provider_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_provider_event_id_unique" UNIQUE("provider","event_id")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_org_id_location_id_locations_org_id_id_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_locations" ADD CONSTRAINT "member_locations_org_id_member_id_members_org_id_id_fk" FOREIGN KEY ("org_id","member_id") REFERENCES "public"."members"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_locations" ADD CONSTRAINT "member_locations_org_id_location_id_locations_org_id_id_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_org_id_parent_id_categories_org_id_id_fk" FOREIGN KEY ("org_id","parent_id") REFERENCES "public"."categories"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_options" ADD CONSTRAINT "modifier_options_org_id_group_id_modifier_groups_org_id_id_fk" FOREIGN KEY ("org_id","group_id") REFERENCES "public"."modifier_groups"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_location_settings" ADD CONSTRAINT "product_location_settings_org_id_product_id_products_org_id_id_fk" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_location_settings" ADD CONSTRAINT "product_location_settings_org_id_location_id_locations_org_id_id_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_org_id_product_id_products_org_id_id_fk" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_org_id_group_id_modifier_groups_org_id_id_fk" FOREIGN KEY ("org_id","group_id") REFERENCES "public"."modifier_groups"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_category_id_categories_org_id_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."categories"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_org_id_location_id_locations_org_id_id_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_org_id_product_id_products_org_id_id_fk" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_org_id_category_id_categories_org_id_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."categories"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_feedback" ADD CONSTRAINT "order_feedback_org_id_order_id_orders_org_id_id_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."orders"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_org_id_order_id_orders_org_id_id_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."orders"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_org_id_product_id_products_org_id_id_fk" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_org_id_voided_by_members_org_id_id_fk" FOREIGN KEY ("org_id","voided_by") REFERENCES "public"."members"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_location_id_locations_org_id_id_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_device_id_devices_org_id_id_fk" FOREIGN KEY ("org_id","device_id") REFERENCES "public"."devices"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_customer_id_customers_org_id_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_created_by_members_org_id_id_fk" FOREIGN KEY ("org_id","created_by") REFERENCES "public"."members"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_order_id_orders_org_id_id_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."orders"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_location_id_locations_org_id_id_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_cash_session_id_cash_sessions_org_id_id_fk" FOREIGN KEY ("org_id","cash_session_id") REFERENCES "public"."cash_sessions"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_reverses_payment_id_payments_org_id_id_fk" FOREIGN KEY ("org_id","reverses_payment_id") REFERENCES "public"."payments"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_created_by_members_org_id_id_fk" FOREIGN KEY ("org_id","created_by") REFERENCES "public"."members"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_device_id_devices_org_id_id_fk" FOREIGN KEY ("org_id","device_id") REFERENCES "public"."devices"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_org_id_cash_session_id_cash_sessions_org_id_id_fk" FOREIGN KEY ("org_id","cash_session_id") REFERENCES "public"."cash_sessions"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_org_id_created_by_members_org_id_id_fk" FOREIGN KEY ("org_id","created_by") REFERENCES "public"."members"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_org_id_location_id_locations_org_id_id_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_org_id_device_id_devices_org_id_id_fk" FOREIGN KEY ("org_id","device_id") REFERENCES "public"."devices"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_org_id_opened_by_members_org_id_id_fk" FOREIGN KEY ("org_id","opened_by") REFERENCES "public"."members"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_org_id_closed_by_members_org_id_id_fk" FOREIGN KEY ("org_id","closed_by") REFERENCES "public"."members"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_cart_items" ADD CONSTRAINT "group_cart_items_org_id_cart_id_group_carts_org_id_id_fk" FOREIGN KEY ("org_id","cart_id") REFERENCES "public"."group_carts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_cart_items" ADD CONSTRAINT "group_cart_items_org_id_participant_id_group_cart_participants_org_id_id_fk" FOREIGN KEY ("org_id","participant_id") REFERENCES "public"."group_cart_participants"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_cart_items" ADD CONSTRAINT "group_cart_items_org_id_product_id_products_org_id_id_fk" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_cart_participants" ADD CONSTRAINT "group_cart_participants_org_id_cart_id_group_carts_org_id_id_fk" FOREIGN KEY ("org_id","cart_id") REFERENCES "public"."group_carts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_carts" ADD CONSTRAINT "group_carts_org_id_location_id_locations_org_id_id_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_carts" ADD CONSTRAINT "group_carts_org_id_order_id_orders_org_id_id_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."orders"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "members_org_user_uq" ON "members" USING btree ("org_id","user_id") WHERE "members"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_product_idx" ON "order_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "orders_location_day_idx" ON "orders" USING btree ("location_id","business_date");--> statement-breakpoint
CREATE INDEX "orders_kitchen_idx" ON "orders" USING btree ("location_id","fulfillment_status") WHERE "orders"."fulfillment_status" in ('pending', 'preparing', 'ready');--> statement-breakpoint
CREATE INDEX "orders_expiry_idx" ON "orders" USING btree ("expires_at") WHERE "orders"."payment_status" = 'unpaid' and "orders"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("org_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_uq" ON "payments" USING btree ("provider","provider_reference") WHERE "payments"."provider_reference" is not null;--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_location_day_idx" ON "payments" USING btree ("location_id","business_date");--> statement-breakpoint
CREATE INDEX "payments_cash_session_idx" ON "payments" USING btree ("cash_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_sessions_one_open_per_device" ON "cash_sessions" USING btree ("device_id") WHERE "cash_sessions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "cash_sessions_location_day_idx" ON "cash_sessions" USING btree ("location_id","business_date");--> statement-breakpoint
CREATE INDEX "group_cart_items_cart_idx" ON "group_cart_items" USING btree ("cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_cart_one_host" ON "group_cart_participants" USING btree ("cart_id") WHERE "group_cart_participants"."is_host";--> statement-breakpoint
CREATE UNIQUE INDEX "group_carts_order_uq" ON "group_carts" USING btree ("order_id") WHERE "group_carts"."order_id" is not null;--> statement-breakpoint
CREATE INDEX "group_carts_expiry_idx" ON "group_carts" USING btree ("expires_at") WHERE "group_carts"."status" in ('open', 'locked');--> statement-breakpoint
CREATE INDEX "audit_log_org_time_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "devices" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "locations" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "member_locations" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "members" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "own_org" ON "orgs" AS PERMISSIVE FOR SELECT TO "bite_app" USING ("orgs"."id" = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "categories" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "modifier_groups" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "modifier_options" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "product_location_settings" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "product_modifier_groups" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "products" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "promotions" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_feedback" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_lines" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "orders" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_movements" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_sessions" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "group_cart_items" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "group_cart_participants" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "group_carts" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_select" ON "audit_log" AS PERMISSIVE FOR SELECT TO "bite_app" USING (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "audit_log" AS PERMISSIVE FOR INSERT TO "bite_app" WITH CHECK (org_id = app_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "billing_subscriptions" AS PERMISSIVE FOR ALL TO "bite_app" USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());