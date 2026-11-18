import {
	type AdminDevice,
	type AdminLocationSettings,
	type AdminStaff,
	CreatePinStaff,
	InviteStaff,
	type InviteStaffResponse,
	RegisterDeviceRequest,
	type RegisterDeviceResponse,
	ResetPin,
	UpdateLocation,
	UpdateStaff,
} from "@bite/contracts";
import { schema, type Tx } from "@bite/db";
import { and, asc, eq, inArray, isNull, sql } from "@bite/db/orm";
import { hash } from "@node-rs/argon2";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { AdminCtx, AppEnv } from "../env.js";
import {
	loadEntitlements,
	requireFeature,
	requireRoomFor,
} from "../lib/entitlements.js";
import { ApiError } from "../lib/errors.js";
import { newSecret, sha256 } from "../lib/tokens.js";
import { validate } from "../lib/validate.js";
import { adminTx, requireLocation } from "../middleware/admin-auth.js";
import { isUniqueViolation } from "../sync/orders.js";

const {
	members,
	memberLocations,
	memberInvites,
	authUsers,
	locations,
	devices,
} = schema;

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const idParam = z.object({ id: z.uuid() });
const notFound = (what: string) =>
	new ApiError("not_found", `${what} not found`);
const forbidden = (msg: string) => new ApiError("forbidden", msg);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

type Role = "manager" | "cashier" | "server" | "kitchen";
type RoleAt = { locationId: string; role: Role };
type MemberRow = typeof members.$inferSelect;

// ---------------------------------------------------------------- staff rules

/**
 * Who may manage whom. Owner: everyone but the owner. Admin: staff only.
 * Manager: staff whose roles touch their locations, and never another manager.
 * Nobody manages themselves here (no self-demotion, no self-deactivation);
 * the self exceptions (name, own PIN) are handled at the call sites.
 */
function canManage(a: AdminCtx, m: MemberRow, roles: RoleAt[]): boolean {
	if (m.id === a.memberId) return false;
	if (a.orgRole === "owner") return m.orgRole !== "owner";
	if (a.orgRole === "admin") return m.orgRole === "staff";
	if (m.orgRole !== "staff") return false;
	if (roles.some((r) => r.role === "manager")) return false;
	return roles.some((r) => a.manages.has(r.locationId));
}

/** Location roles the caller may hand out. 404 outside scope, like everywhere else. */
function checkRoles(a: AdminCtx, c: Context<AppEnv>, roles: RoleAt[]) {
	const ids = roles.map((r) => r.locationId);
	if (new Set(ids).size !== ids.length) {
		throw new ApiError("bad_request", "one role per location");
	}
	if (a.orgWide) return;
	for (const r of roles) {
		requireLocation(c, r.locationId);
		if (r.role === "manager")
			throw forbidden("only owners/admins appoint managers");
	}
}

function checkOrgRole(a: AdminCtx, orgRole: "admin" | "staff" | undefined) {
	if (orgRole === undefined) return;
	if (orgRole === "admin" && a.orgRole !== "owner") {
		throw forbidden("only the owner appoints admins");
	}
	if (!a.orgWide && orgRole !== "staff")
		throw forbidden("managers can't set org roles");
}

async function loadTarget(tx: Tx, id: string) {
	const [m] = await tx.select().from(members).where(eq(members.id, id));
	if (!m) throw notFound("staff member");
	const roles = await tx
		.select({
			locationId: memberLocations.locationId,
			role: memberLocations.role,
		})
		.from(memberLocations)
		.where(eq(memberLocations.memberId, id));
	return { m, roles };
}

/** Loads, then 404s anyone the caller can't see and 403s anyone they can't manage. */
async function managedTarget(c: Context<AppEnv>, tx: Tx, id: string) {
	const a = c.var.admin;
	const t = await loadTarget(tx, id);
	const visible = a.orgWide || t.roles.some((r) => a.manages.has(r.locationId));
	if (!visible) throw notFound("staff member");
	if (!canManage(a, t.m, t.roles))
		throw forbidden("not allowed to manage this member");
	return t;
}

async function setRoles(
	tx: Tx,
	orgId: string,
	memberId: string,
	roles: RoleAt[],
) {
	await tx
		.delete(memberLocations)
		.where(eq(memberLocations.memberId, memberId));
	if (roles.length === 0) return;
	await tx
		.insert(memberLocations)
		.values(roles.map((r) => ({ orgId, memberId, ...r })));
}

async function staffDtos(
	tx: Tx,
	a: AdminCtx,
	ids?: string[],
): Promise<AdminStaff[]> {
	const rows = await tx
		.select({ m: members, email: authUsers.email })
		.from(members)
		.leftJoin(authUsers, eq(authUsers.id, members.userId))
		.where(ids ? inArray(members.id, ids) : undefined)
		.orderBy(asc(members.displayName), asc(members.id));
	if (rows.length === 0) return [];
	const roles = await tx
		.select()
		.from(memberLocations)
		.where(
			inArray(
				memberLocations.memberId,
				rows.map((r) => r.m.id),
			),
		);
	// Pending invites show the invited address until accepted.
	const invites = await tx
		.select({ memberId: memberInvites.memberId, email: memberInvites.email })
		.from(memberInvites)
		.where(isNull(memberInvites.acceptedAt));
	const out: AdminStaff[] = [];
	for (const { m, email } of rows) {
		const mine = roles
			.filter((r) => r.memberId === m.id)
			.map((r) => ({ locationId: r.locationId, role: r.role }));
		const inScope = a.orgWide
			? mine
			: mine.filter((r) => a.manages.has(r.locationId));
		// Managers see only staff working at their locations, and only those roles.
		if (!a.orgWide && inScope.length === 0) continue;
		out.push({
			id: m.id,
			displayName: m.displayName,
			email: email ?? invites.find((i) => i.memberId === m.id)?.email ?? null,
			orgRole: m.orgRole,
			hasPin: m.pinHash !== null,
			isActive: m.isActive,
			locations: inScope,
		});
	}
	return out;
}

async function staffDto(tx: Tx, a: AdminCtx, id: string) {
	const [dto] = await staffDtos(tx, a, [id]);
	if (!dto) throw notFound("staff member");
	return dto;
}

async function issueInvite(
	tx: Tx,
	a: AdminCtx,
	memberId: string,
	email: string,
	now: Date,
) {
	await tx
		.delete(memberInvites)
		.where(
			and(
				eq(memberInvites.memberId, memberId),
				isNull(memberInvites.acceptedAt),
			),
		);
	const token = newSecret("inv_");
	const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
	await tx.insert(memberInvites).values({
		orgId: a.orgId,
		memberId,
		email: email.toLowerCase(),
		tokenHash: sha256(token),
		expiresAt,
		createdBy: a.memberId,
	});
	return { inviteToken: token, expiresAt: expiresAt.toISOString() };
}

// ---------------------------------------------------------------- locations

type LocationRow = typeof locations.$inferSelect;
const locationDto = (l: LocationRow): AdminLocationSettings => ({
	id: l.id,
	name: l.name,
	slug: l.slug,
	isActive: l.isActive,
	timezone: l.timezone,
	currencyCode: l.currencyCode,
	pricesIncludeTax: l.pricesIncludeTax,
	taxBps: l.taxBps,
	vatNumber: l.vatNumber,
	dayCutoffMinutes: l.dayCutoffMinutes,
	address: l.address,
	phone: l.phone,
	whatsappNumber: l.whatsappNumber,
	businessHours: l.businessHours ?? null,
	theme: l.theme,
	receiptHeader: l.receiptHeader,
	ordersPausedUntil: iso(l.ordersPausedUntil),
});

/** Money, tax and identity settings: owners/admins only. */
const ORG_WIDE_FIELDS = [
	"name",
	"isActive",
	"timezone",
	"pricesIncludeTax",
	"taxBps",
	"vatNumber",
	"dayCutoffMinutes",
] as const;

type DeviceRow = typeof devices.$inferSelect;
const deviceDto = (d: DeviceRow): AdminDevice => ({
	id: d.id,
	locationId: d.locationId,
	name: d.name,
	kind: d.kind,
	ticketPrefix: d.ticketPrefix,
	lastSeenAt: iso(d.lastSeenAt),
	revokedAt: iso(d.revokedAt),
});

const now = (c: Context<AppEnv>) => c.var.deps.now?.() ?? new Date();

/** Plan check before adding a staff member: active members across the org. */
function requireStaffRoom(c: Context<AppEnv>, tx: Tx) {
	return requireRoomFor(
		tx,
		c.var.deps,
		c.var.admin.orgId,
		"staff",
		async () => {
			const [r] = await tx
				.select({ n: sql<number>`count(*)::int` })
				.from(members)
				.where(eq(members.isActive, true));
			return r?.n ?? 0;
		},
	);
}

// ---------------------------------------------------------------- routes

export const adminOrgRoutes = new Hono<AppEnv>()
	.get("/staff", async (c) => {
		const items = await adminTx(c, (tx) => staffDtos(tx, c.var.admin));
		return c.json({ items });
	})
	.post("/staff/invite", validate("json", InviteStaff), async (c) => {
		const a = c.var.admin;
		const b = c.req.valid("json");
		checkOrgRole(a, b.orgRole);
		checkRoles(a, c, b.locations);
		const email = b.email.toLowerCase();
		const res = await adminTx(c, async (tx) => {
			const [taken] = await tx
				.select({ id: members.id })
				.from(members)
				.innerJoin(authUsers, eq(authUsers.id, members.userId))
				.where(eq(sql`lower(${authUsers.email})`, email));
			const [pending] = await tx
				.select({ id: memberInvites.id })
				.from(memberInvites)
				.where(
					and(eq(memberInvites.email, email), isNull(memberInvites.acceptedAt)),
				);
			if (taken || pending) {
				throw new ApiError("conflict", "already a member or invited", {
					field: "email",
				});
			}
			await requireStaffRoom(c, tx);
			const [m] = await tx
				.insert(members)
				.values({
					orgId: a.orgId,
					displayName: b.displayName,
					orgRole: b.orgRole,
				})
				.returning({ id: members.id });
			const memberId = (m as { id: string }).id;
			await setRoles(tx, a.orgId, memberId, b.locations);
			const invite = await issueInvite(tx, a, memberId, email, now(c));
			const out: InviteStaffResponse = {
				staff: await staffDto(tx, a, memberId),
				...invite,
			};
			return out;
		});
		return c.json(res, 201);
	})
	.post("/staff", validate("json", CreatePinStaff), async (c) => {
		const a = c.var.admin;
		const b = c.req.valid("json");
		checkRoles(a, c, b.locations);
		const pinHash = await hash(b.pin);
		const dto = await adminTx(c, async (tx) => {
			await requireStaffRoom(c, tx);
			const [m] = await tx
				.insert(members)
				.values({ orgId: a.orgId, displayName: b.displayName, pinHash })
				.returning({ id: members.id });
			const memberId = (m as { id: string }).id;
			await setRoles(tx, a.orgId, memberId, b.locations);
			return staffDto(tx, a, memberId);
		});
		return c.json(dto, 201);
	})
	.patch(
		"/staff/:id",
		validate("param", idParam),
		validate("json", UpdateStaff),
		async (c) => {
			const a = c.var.admin;
			const { id } = c.req.valid("param");
			const b = c.req.valid("json");
			const dto = await adminTx(c, async (tx) => {
				const self = id === a.memberId;
				if (self) {
					// Your own name, nothing else: no self-promotion or self-demotion.
					if (b.orgRole !== undefined || b.locations !== undefined) {
						throw forbidden("can't change your own role");
					}
				} else {
					const t = await managedTarget(c, tx, id);
					checkOrgRole(a, b.orgRole);
					if (b.locations) {
						checkRoles(a, c, b.locations);
						// A manager edits only their slice; roles elsewhere survive.
						const kept = a.orgWide
							? []
							: t.roles.filter((r) => !a.manages.has(r.locationId));
						await setRoles(tx, a.orgId, id, [...kept, ...b.locations]);
					}
				}
				const set = {
					...(b.displayName !== undefined
						? { displayName: b.displayName }
						: {}),
					...(!self && b.orgRole !== undefined ? { orgRole: b.orgRole } : {}),
				};
				if (Object.keys(set).length > 0) {
					await tx
						.update(members)
						.set({ ...set, updatedAt: new Date() })
						.where(eq(members.id, id));
				}
				return staffDto(tx, a, id);
			});
			return c.json(dto);
		},
	)
	.post(
		"/staff/:id/reset-pin",
		validate("param", idParam),
		validate("json", ResetPin),
		async (c) => {
			const a = c.var.admin;
			const { id } = c.req.valid("param");
			const pinHash = await hash(c.req.valid("json").pin);
			const dto = await adminTx(c, async (tx) => {
				// Setting your own PIN is fine (owners work the till too).
				if (id !== a.memberId) await managedTarget(c, tx, id);
				await tx
					.update(members)
					.set({ pinHash, updatedAt: new Date() })
					.where(eq(members.id, id));
				return staffDto(tx, a, id);
			});
			return c.json(dto);
		},
	)
	.post("/staff/:id/deactivate", validate("param", idParam), async (c) => {
		const { id } = c.req.valid("param");
		const dto = await adminTx(c, async (tx) => {
			if (id === c.var.admin.memberId)
				throw forbidden("can't deactivate yourself");
			await managedTarget(c, tx, id);
			await tx
				.update(members)
				.set({ isActive: false, updatedAt: new Date() })
				.where(eq(members.id, id));
			await tx
				.delete(memberInvites)
				.where(
					and(eq(memberInvites.memberId, id), isNull(memberInvites.acceptedAt)),
				);
			return staffDto(tx, c.var.admin, id);
		});
		return c.json(dto);
	})
	.post("/staff/:id/invite", validate("param", idParam), async (c) => {
		// Re-issue a lost or expired invite. The old link stops working.
		const a = c.var.admin;
		const { id } = c.req.valid("param");
		const res = await adminTx(c, async (tx) => {
			const t = await managedTarget(c, tx, id);
			if (t.m.userId) throw new ApiError("conflict", "already has a login");
			const [prev] = await tx
				.select({ email: memberInvites.email })
				.from(memberInvites)
				.where(eq(memberInvites.memberId, id))
				.orderBy(sql`${memberInvites.createdAt} desc`)
				.limit(1);
			if (!prev)
				throw new ApiError(
					"unprocessable",
					"never invited; use POST /staff/invite",
				);
			const invite = await issueInvite(tx, a, id, prev.email, now(c));
			const out: InviteStaffResponse = {
				staff: await staffDto(tx, a, id),
				...invite,
			};
			return out;
		});
		return c.json(res);
	})
	// locations
	.get("/locations", async (c) => {
		const ids = [...c.var.admin.manages];
		const rows =
			ids.length === 0
				? []
				: await adminTx(c, (tx) =>
						tx
							.select()
							.from(locations)
							.where(inArray(locations.id, ids))
							.orderBy(asc(locations.name)),
					);
		return c.json({ items: rows.map(locationDto) });
	})
	.patch(
		"/locations/:id",
		validate("param", idParam),
		validate("json", UpdateLocation),
		async (c) => {
			const a = c.var.admin;
			const { id } = c.req.valid("param");
			requireLocation(c, id);
			const b = c.req.valid("json");
			if (!a.orgWide) {
				const touched = ORG_WIDE_FIELDS.filter((f) => b[f] !== undefined);
				if (touched.length > 0) {
					throw forbidden(`owner/admin only: ${touched.join(", ")}`);
				}
			}
			const set = Object.fromEntries(
				Object.entries({
					...b,
					ordersPausedUntil:
						b.ordersPausedUntil === undefined
							? undefined
							: b.ordersPausedUntil && new Date(b.ordersPausedUntil),
				}).filter(([, v]) => v !== undefined),
			);
			const [row] = await adminTx(c, (tx) =>
				tx
					.update(locations)
					.set({ ...set, updatedAt: new Date() })
					.where(eq(locations.id, id))
					.returning(),
			);
			if (!row) throw notFound("location");
			return c.json(locationDto(row));
		},
	)
	// devices
	.get("/locations/:id/devices", validate("param", idParam), async (c) => {
		const { id } = c.req.valid("param");
		requireLocation(c, id);
		const rows = await adminTx(c, (tx) =>
			tx
				.select()
				.from(devices)
				.where(eq(devices.locationId, id))
				.orderBy(asc(devices.name), asc(devices.id)),
		);
		return c.json({ items: rows.map(deviceDto) });
	})
	.post("/devices", validate("json", RegisterDeviceRequest), async (c) => {
		const b = c.req.valid("json");
		requireLocation(c, b.locationId);
		const token = newSecret("dev_");
		try {
			const [row] = await adminTx(c, async (tx) => {
				const { deps, admin } = c.var;
				if (deps.planEnforcement && b.kind === "kds") {
					requireFeature(await loadEntitlements(tx, deps, admin.orgId), "kds");
				}
				// Revoked devices don't count: replacing a broken tablet is free.
				await requireRoomFor(
					tx,
					deps,
					admin.orgId,
					"devicesPerLocation",
					async () => {
						const [r] = await tx
							.select({ n: sql<number>`count(*)::int` })
							.from(devices)
							.where(
								and(
									eq(devices.locationId, b.locationId),
									isNull(devices.revokedAt),
								),
							);
						return r?.n ?? 0;
					},
					b.locationId,
				);
				return tx
					.insert(devices)
					.values({
						orgId: admin.orgId,
						locationId: b.locationId,
						name: b.name,
						kind: b.kind,
						ticketPrefix: b.ticketPrefix,
						tokenHash: sha256(token),
					})
					.returning({ id: devices.id });
			});
			const res: RegisterDeviceResponse = {
				deviceId: (row as { id: string }).id,
				token,
			};
			return c.json(res, 201);
		} catch (err) {
			if (isUniqueViolation(err, "devices_location_id_ticket_prefix_unique")) {
				throw new ApiError(
					"conflict",
					"ticket prefix in use at this location",
					{
						field: "ticketPrefix",
					},
				);
			}
			throw err;
		}
	})
	.post("/devices/:id/revoke", validate("param", idParam), async (c) => {
		const { id } = c.req.valid("param");
		const row = await adminTx(c, async (tx) => {
			const [d] = await tx.select().from(devices).where(eq(devices.id, id));
			if (!d) throw notFound("device");
			requireLocation(c, d.locationId);
			const [u] = await tx
				.update(devices)
				.set({
					revokedAt: sql`coalesce(${devices.revokedAt}, now())`,
					updatedAt: new Date(),
				})
				.where(eq(devices.id, id))
				.returning();
			return u as DeviceRow;
		});
		return c.json(deviceDto(row));
	});
