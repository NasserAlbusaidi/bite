import {
	type DeviceMe,
	PinLoginRequest,
	type PinLoginResponse,
	SetAvailabilityRequest,
	type StaffListResponse,
} from "@bite/contracts";
import { schema } from "@bite/db";
import { and, asc, eq, isNotNull } from "@bite/db/orm";
import { hash, verify } from "@node-rs/argon2";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { tenantTx } from "../lib/tenant.js";
import { signStaffToken } from "../lib/tokens.js";
import { validate } from "../lib/validate.js";
import { setAvailability } from "../menu/availability.js";
import { loadMenuSnapshot } from "../menu/snapshot.js";
import { deviceAuth } from "../middleware/device-auth.js";
import { staffAuth } from "../middleware/staff-auth.js";

const { members, memberLocations } = schema;

const STAFF_TTL_SECONDS = 12 * 60 * 60;

/** Verified against when the member has no PIN, so timing doesn't leak membership. */
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => {
	dummyHash ??= hash("dummy-pin-never-matches");
	return dummyHash;
};

export const deviceRoutes = new Hono<AppEnv>()
	.use(deviceAuth)
	.get("/me", (c) => {
		const d = c.var.device;
		const body: DeviceMe = {
			deviceId: d.deviceId,
			orgId: d.orgId,
			locationId: d.locationId,
			kind: d.kind,
			ticketPrefix: d.ticketPrefix,
			name: d.name,
		};
		return c.json(body);
	})
	/**
	 * Full menu for this device's location. Sends ETag = menuVersion and
	 * answers 304 when If-None-Match matches, so polling is cheap.
	 */
	.get("/menu", async (c) => {
		const now = c.var.deps.now?.() ?? new Date();
		const menu = await tenantTx(c, (tx) =>
			loadMenuSnapshot(tx, c.var.device.locationId, now),
		);
		if (!menu) throw new ApiError("not_found", "location not visible");
		const etag = `"${menu.menuVersion}"`;
		c.header("etag", etag);
		if (c.req.header("if-none-match") === etag) return c.body(null, 304);
		return c.json(menu);
	})
	/** 86 / un-86 at this device's location. Any role except server. */
	.put(
		"/products/:productId/availability",
		staffAuth(["manager", "cashier", "kitchen"]),
		validate("param", z.object({ productId: z.uuid() })),
		validate("json", SetAvailabilityRequest),
		async (c) => {
			const { productId } = c.req.valid("param");
			const { isAvailable } = c.req.valid("json");
			const d = c.var.device;
			await tenantTx(c, (tx) =>
				setAvailability(tx, d.orgId, d.locationId, productId, isAvailable),
			);
			return c.json({ productId, isAvailable });
		},
	)
	/** Who is logged in on this tablet. POS calls it on resume to check the staff token. */
	.get("/session", staffAuth(), (c) => c.json({ member: c.var.staff }))
	/** Lock-screen staff picker: active members of this location who have a PIN. */
	.get("/staff", async (c) => {
		const staff = await tenantTx(c, (tx) =>
			tx
				.select({
					memberId: members.id,
					displayName: members.displayName,
					role: memberLocations.role,
				})
				.from(members)
				.innerJoin(memberLocations, eq(memberLocations.memberId, members.id))
				.where(
					and(
						eq(memberLocations.locationId, c.var.device.locationId),
						eq(members.isActive, true),
						isNotNull(members.pinHash),
					),
				)
				.orderBy(asc(members.displayName)),
		);
		const body: StaffListResponse = { staff };
		return c.json(body);
	})
	.post("/pin-login", validate("json", PinLoginRequest), async (c) => {
		const { memberId, pin } = c.req.valid("json");
		const { deps, device } = c.var;
		const key = `${device.deviceId}:${memberId}`;
		if (deps.pinLimiter.isLocked(key)) {
			throw new ApiError("rate_limited", "too many wrong PINs, wait 5 minutes");
		}
		const row = await tenantTx(c, async (tx) => {
			const [r] = await tx
				.select({
					memberId: members.id,
					displayName: members.displayName,
					orgRole: members.orgRole,
					pinHash: members.pinHash,
					role: memberLocations.role,
				})
				.from(members)
				.innerJoin(
					memberLocations,
					and(
						eq(memberLocations.memberId, members.id),
						eq(memberLocations.locationId, device.locationId),
					),
				)
				.where(and(eq(members.id, memberId), eq(members.isActive, true)));
			return r;
		});
		const ok = await verify(row?.pinHash ?? (await getDummyHash()), pin).catch(
			() => false,
		);
		if (!row?.pinHash || !ok) {
			deps.pinLimiter.fail(key);
			throw new ApiError("unauthenticated", "wrong PIN");
		}
		deps.pinLimiter.reset(key);
		const now = (deps.now?.() ?? new Date()).getTime();
		const exp = Math.floor(now / 1000) + STAFF_TTL_SECONDS;
		const body: PinLoginResponse = {
			staffToken: signStaffToken(
				{ m: row.memberId, d: device.deviceId, o: device.orgId, exp },
				deps.staffTokenSecret,
			),
			expiresAt: new Date(exp * 1000).toISOString(),
			member: {
				memberId: row.memberId,
				displayName: row.displayName,
				orgRole: row.orgRole,
				role: row.role,
			},
		};
		return c.json(body);
	});
