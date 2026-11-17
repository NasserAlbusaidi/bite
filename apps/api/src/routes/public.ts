import {
	CreateGuestOrderRequest,
	type CreateGuestOrderResponse,
	IDEMPOTENCY_KEY_HEADER,
	type PublicMenuResponse,
} from "@bite/contracts";
import { schema, withTenant } from "@bite/db";
import { eq, sql } from "@bite/db/orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { slugTx } from "../lib/public-tenant.js";
import { validate } from "../lib/validate.js";
import { acceptsOrders } from "../menu/hours.js";
import { loadMenuSnapshot } from "../menu/snapshot.js";
import { loadOrderDto } from "../orders/dto.js";
import {
	guestFingerprint,
	placeGuestOrder,
	toGuestView,
} from "../orders/guest.js";

const { locations, orgs } = schema;

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Unauthenticated guest routes. Everything here is reachable from a QR code. */
const IdemKey = z.string().min(8).max(200);

export const publicRoutes = new Hono<AppEnv>()
	.post(
		"/locations/:slug/orders",
		validate("json", CreateGuestOrderRequest),
		async (c) => {
			const key = IdemKey.safeParse(c.req.header(IDEMPOTENCY_KEY_HEADER));
			if (!key.success)
				throw new ApiError(
					"bad_request",
					"Idempotency-Key header (8-200 chars) is required",
				);
			const body = c.req.valid("json");
			const slug = c.req.param("slug");
			if (body.locationSlug !== slug)
				throw new ApiError(
					"bad_request",
					"locationSlug does not match the URL",
				);
			const now = c.var.deps.now?.() ?? new Date();
			const { lines, type, customerName, customerPhone, note } = body;
			const input = { lines, type, customerName, customerPhone, note };
			const out = await slugTx(c, slug, (tx, ids) =>
				placeGuestOrder(tx, ids, input, {
					source: "guest",
					now,
					idempotencyKey: key.data,
					fingerprint: guestFingerprint(input, slug),
				}),
			);
			const res: CreateGuestOrderResponse = { order: out.view };
			return c.json(res, out.created ? 201 : 200);
		},
	)
	/** Guest tracking link. The token is the only credential. */
	.get(
		"/orders/:trackingToken",
		validate("param", z.object({ trackingToken: z.uuid() })),
		async (c) => {
			const token = c.req.valid("param").trackingToken;
			const rows = (await c.var.deps.db.execute(
				sql`select org_id, order_id from resolve_tracking_token(${token}::uuid)`,
			)) as unknown as { org_id: string; order_id: string }[];
			const r = rows[0];
			if (!r) throw new ApiError("not_found", "no such order");
			const dto = await withTenant(c.var.deps.db, r.org_id, (tx) =>
				loadOrderDto(tx, r.order_id),
			);
			if (!dto) throw new ApiError("not_found", "no such order");
			c.header("cache-control", "no-store");
			return c.json(toGuestView(dto, token));
		},
	)
	.get("/locations/:slug/menu", async (c) => {
		const now = c.var.deps.now?.() ?? new Date();
		const body = await slugTx(c, c.req.param("slug"), async (tx, ids) => {
			const [row] = await tx
				.select({ loc: locations, orgName: orgs.name })
				.from(locations)
				.innerJoin(orgs, eq(orgs.id, locations.orgId))
				.where(eq(locations.id, ids.locationId));
			const menu = await loadMenuSnapshot(tx, ids.locationId, now);
			if (!row || !menu) throw new ApiError("not_found", "no such location");
			const theme = row.loc.theme;
			const accent = str(theme.accent);
			const logoUrl = str(theme.logoUrl);
			const res: PublicMenuResponse = {
				location: {
					slug: row.loc.slug,
					name: row.loc.name,
					orgName: row.orgName,
					isAcceptingOrders: acceptsOrders(row.loc, now),
					theme: {
						...(accent ? { accent } : {}),
						...(logoUrl ? { logoUrl } : {}),
					},
				},
				menu,
			};
			return res;
		});
		c.header("cache-control", "public, max-age=15");
		return c.json(body);
	});
