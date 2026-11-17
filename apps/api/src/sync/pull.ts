import type { SyncPullQuery, SyncPullResponse } from "@bite/contracts";
import { schema, withTenant } from "@bite/db";
import { and, asc, eq, gte, inArray, or, sql } from "@bite/db/orm";
import type { Deps, DeviceCtx } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { loadMenuSnapshot } from "../menu/snapshot.js";
import { loadOrderDtos } from "../orders/dto.js";

const { orders } = schema;
const PAGE = 200;

/**
 * Cursor = { x: snapshot xmin floor, a?: [xid, id] last row of a full page }.
 * Every row with change_xid >= x is (re)sent; rows can repeat across pulls,
 * and clients upsert by version. A transaction still in flight when we read
 * has an xid >= the xmin we save, so its rows are picked up next time.
 */
type Cur = { x: string; a?: [string, string] };
const enc = (c: Cur) => Buffer.from(JSON.stringify(c)).toString("base64url");
function dec(s: string): Cur {
	try {
		const c = JSON.parse(Buffer.from(s, "base64url").toString()) as Cur;
		if (!/^\d+$/.test(c.x)) throw new Error();
		if (c.a && (!/^\d+$/.test(c.a[0]) || !/^[0-9a-f-]{36}$/i.test(c.a[1])))
			throw new Error();
		return c;
	} catch {
		throw new ApiError("bad_request", "invalid cursor");
	}
}

export async function pullChanges(
	deps: Deps,
	device: DeviceCtx,
	q: SyncPullQuery,
): Promise<SyncPullResponse> {
	const now = deps.now?.() ?? new Date();
	return withTenant(deps.db, device.orgId, async (tx) => {
		const [{ xmin } = { xmin: "0" }] = (await tx.execute(
			sql`select pg_snapshot_xmin(pg_current_snapshot())::text as xmin`,
		)) as unknown as { xmin: string }[];
		const menu = await loadMenuSnapshot(tx, device.locationId, now);
		if (!menu) throw new ApiError("not_found", "location not visible");

		let rows: (typeof orders.$inferSelect)[];
		let next: Cur;
		let hasMore = false;
		if (!q.cursor) {
			// First sync: everything still open, plus today's and yesterday's tickets.
			const today = menu.location;
			const since = sql`(now() at time zone ${today.timezone})::date - 1`;
			rows = await tx
				.select()
				.from(orders)
				.where(
					and(
						eq(orders.locationId, device.locationId),
						or(
							inArray(orders.fulfillmentStatus, [
								"pending",
								"preparing",
								"ready",
							]),
							gte(orders.businessDate, since),
						),
					),
				)
				.orderBy(asc(orders.placedAt));
			next = { x: xmin };
		} else {
			const c = dec(q.cursor);
			const after = c.a
				? sql`and (${orders.changeXid}, ${orders.id}) > (${c.a[0]}::xid8, ${c.a[1]}::uuid)`
				: sql``;
			rows = await tx
				.select()
				.from(orders)
				.where(
					sql`${orders.locationId} = ${device.locationId} and ${orders.changeXid} >= ${c.x}::xid8 ${after}`,
				)
				.orderBy(asc(orders.changeXid), asc(orders.id))
				.limit(PAGE);
			const last = rows.at(-1);
			if (rows.length === PAGE && last) {
				hasMore = true;
				next = { x: c.x, a: [last.changeXid, last.id] };
			} else {
				next = { x: xmin };
			}
		}
		return {
			cursor: enc(next),
			hasMore,
			menuVersion: menu.menuVersion,
			...(q.menuVersion === menu.menuVersion ? {} : { menu }),
			orders: await loadOrderDtos(tx, rows),
		};
	});
}
