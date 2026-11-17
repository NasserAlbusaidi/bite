import { z } from "zod";
import { DeviceKind, Id, Instant, LocationRole, OrgRole } from "./common.js";

/**
 * Three ways in:
 * - Back office: Better Auth session cookie (owners/admins/managers), routes under /v1/auth/*.
 * - Tablet: `Authorization: Bearer <device token>`. Issued once at pairing, revocable.
 * - Staff on a tablet: PIN login over the device token returns a short-lived
 *   staff token sent as `X-Staff-Token`. Every POS mutation is attributed to it.
 */
export const DEVICE_AUTH_HEADER = "authorization";
export const STAFF_TOKEN_HEADER = "x-staff-token";

/** Manager registers a tablet in the back office. Token is shown exactly once. */
export const RegisterDeviceRequest = z.object({
	locationId: Id,
	name: z.string().min(1).max(80),
	kind: DeviceKind,
	ticketPrefix: z
		.string()
		.regex(
			/^(?:[A-FH-PR-Z]|[A-Z]{2})$/,
			"1-2 letters; Q and G alone are reserved for QR and group orders",
		),
});
export const RegisterDeviceResponse = z.object({
	deviceId: Id,
	/** Plaintext device token. Only returned here; the server stores a hash. */
	token: z.string(),
});

export const DeviceMe = z.object({
	deviceId: Id,
	orgId: Id,
	locationId: Id,
	kind: DeviceKind,
	ticketPrefix: z.string(),
	name: z.string(),
});

/** PIN-only staff picker on the lock screen. No PIN hashes, ever. */
export const StaffListItem = z.object({
	memberId: Id,
	displayName: z.string(),
	role: LocationRole,
});
export const StaffListResponse = z.object({ staff: z.array(StaffListItem) });

export const PinLoginRequest = z.object({
	memberId: Id,
	pin: z.string().regex(/^\d{4,8}$/),
});
export const PinLoginResponse = z.object({
	staffToken: z.string(),
	expiresAt: Instant,
	member: z.object({
		memberId: Id,
		displayName: z.string(),
		orgRole: OrgRole,
		role: LocationRole,
	}),
});

export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequest>;
export type RegisterDeviceResponse = z.infer<typeof RegisterDeviceResponse>;
export type DeviceMe = z.infer<typeof DeviceMe>;
export type StaffListItem = z.infer<typeof StaffListItem>;
export type StaffListResponse = z.infer<typeof StaffListResponse>;
export type PinLoginRequest = z.infer<typeof PinLoginRequest>;
export type PinLoginResponse = z.infer<typeof PinLoginResponse>;
