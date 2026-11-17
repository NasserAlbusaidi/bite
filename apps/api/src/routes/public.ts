import type { PublicMenuResponse } from "@bite/contracts";
import { schema } from "@bite/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { slugTx } from "../lib/public-tenant.js";
import { isOpenAt } from "../menu/hours.js";
import { loadMenuSnapshot } from "../menu/snapshot.js";

const { locations, orgs } = schema;

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Unauthenticated guest routes. Everything here is reachable from a QR code. */
export const publicRoutes = new Hono<AppEnv>().get(
	"/locations/:slug/menu",
	async (c) => {
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
					isAcceptingOrders: isOpenAt(
						row.loc.businessHours,
						row.loc.timezone,
						now,
					),
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
	},
);
