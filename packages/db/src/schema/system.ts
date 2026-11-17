import {
	foreignKey,
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import {
	appendOnlyPolicies,
	createdAt,
	id,
	orgId,
	tenantPolicy,
	updatedAt,
} from "./_shared.js";
import { orgs } from "./tenancy.js";

/** Append-only. The app role has no UPDATE/DELETE policy on it. */
export const auditLog = pgTable(
	"audit_log",
	{
		id: id(),
		orgId: orgId().references(() => orgs.id, { onDelete: "restrict" }),
		locationId: uuid("location_id"),
		actorMemberId: uuid("actor_member_id"),
		actorDeviceId: uuid("actor_device_id"),
		action: text("action").notNull(),
		entityType: text("entity_type"),
		entityId: uuid("entity_id"),
		data: jsonb("data").$type<Record<string, unknown>>(),
		createdAt: createdAt(),
	},
	(t) => [
		index("audit_log_org_time_idx").on(t.orgId, t.createdAt),
		index("audit_log_entity_idx").on(t.entityType, t.entityId),
		...appendOnlyPolicies(),
	],
);

export const billingProvider = pgEnum("billing_provider", [
	"stripe",
	"thawani",
	"manual",
]);

export const billingSubscriptions = pgTable(
	"billing_subscriptions",
	{
		id: id(),
		orgId: orgId(),
		provider: billingProvider("provider").notNull(),
		providerCustomerId: text("provider_customer_id"),
		providerSubscriptionId: text("provider_subscription_id"),
		plan: text("plan").notNull(),
		status: text("status").notNull(),
		currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
		cancelAt: timestamp("cancel_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		unique().on(t.provider, t.providerSubscriptionId),
		foreignKey({ columns: [t.orgId], foreignColumns: [orgs.id] }).onDelete(
			"restrict",
		),
		tenantPolicy(),
	],
);

/**
 * Inbound provider webhooks, deduplicated. Not tenant-scoped (the tenant is
 * resolved from the payload), so no RLS: only the system role touches it.
 */
export const webhookEvents = pgTable(
	"webhook_events",
	{
		id: id(),
		provider: text("provider").notNull(),
		eventId: text("event_id").notNull(),
		eventType: text("event_type"),
		payload: jsonb("payload").notNull(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
		createdAt: createdAt(),
	},
	(t) => [unique().on(t.provider, t.eventId)],
);
