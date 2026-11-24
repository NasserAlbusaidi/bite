import { z } from "zod";
import {
	BusinessDate,
	Id,
	Instant,
	LocalizedText,
	Minor,
	NonNegMinor,
	PaymentStatus,
} from "./common.js";

/**
 * Loyalty (per org, shared by every branch).
 *
 * Guest menu, under /v1/public, guest token in the GUEST_TOKEN_HEADER:
 *   GET  /locations/:slug/guest                 -> GuestProfile (404 without a known token)
 *   POST /locations/:slug/orders  {rewardId?}   -> CreateGuestOrderResponse.guest
 * Back office, under /v1/admin:
 *   GET  /loyalty                               -> LoyaltyProgram
 *   PUT  /loyalty            LoyaltyProgram     -> LoyaltyProgram
 *   GET  /customers?q=&cursor=                  -> Page<AdminCustomer>
 *   GET  /customers/:id                         -> AdminCustomerDetail
 *   POST /customers/:id/points AdjustPoints     -> AdminCustomerDetail
 * Till, under /v1/device (online only):
 *   GET  /customers?phone=                      -> TillCustomer (404 when unknown)
 *   POST /orders/:id/redeem   TillRedeem        -> TillRedeemResponse
 */
export const GUEST_TOKEN_HEADER = "x-bite-guest";

export const LoyaltyReward = z.object({
	id: z
		.string()
		.min(1)
		.max(40)
		.regex(/^[a-z0-9-]+$/),
	name: LocalizedText,
	points: z.int().min(1).max(100_000),
	value: NonNegMinor.refine((n) => n > 0 && n <= 1_000_000, "1 to 1,000,000"),
});

export const LoyaltyProgram = z.object({
	enabled: z.boolean(),
	pointsPerRial: z.int().min(0).max(1000),
	rewards: z
		.array(LoyaltyReward)
		.max(12)
		.refine(
			(r) => new Set(r.map((x) => x.id)).size === r.length,
			"reward ids must be unique",
		),
});

export const GuestPastOrder = z.object({
	ticketNumber: z.string(),
	placedAt: Instant,
	total: Minor,
	paymentStatus: PaymentStatus,
	lines: z.array(
		z.object({
			productId: Id.nullable(),
			name: LocalizedText,
			quantity: z.int(),
			modifierOptionIds: z.array(Id),
		}),
	),
});

export const GuestProfile = z.object({
	name: z.string().nullable(),
	/** "•••• 4567" */
	phoneHint: z.string(),
	points: z.int(),
	visitCount: z.int(),
	program: LoyaltyProgram,
	/** Newest first, at most 5. */
	recentOrders: z.array(GuestPastOrder),
});

export const AdminCustomer = z.object({
	id: Id,
	name: z.string().nullable(),
	phone: z.string(),
	points: z.int(),
	visitCount: z.int(),
	totalSpent: Minor,
	lastVisitAt: Instant.nullable(),
	createdAt: Instant,
});

export const LoyaltyLedgerRow = z.object({
	id: Id,
	kind: z.enum(["earn", "redeem", "adjust"]),
	points: z.int(),
	ticketNumber: z.string().nullable(),
	rewardId: z.string().nullable(),
	reason: z.string().nullable(),
	createdAt: Instant,
});

export const AdminCustomerDetail = AdminCustomer.extend({
	favorites: z.array(z.object({ name: LocalizedText, count: z.int() })),
	orders: z.array(
		z.object({
			id: Id,
			ticketNumber: z.string(),
			businessDate: BusinessDate,
			locationName: z.string(),
			total: Minor,
			paymentStatus: PaymentStatus,
		}),
	),
	ledger: z.array(LoyaltyLedgerRow),
});

export const AdminCustomersQuery = z.object({
	q: z.string().max(80).optional(),
	sort: z.enum(["recent", "visits", "spent", "points"]).optional(),
	limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const AdjustPoints = z.object({
	points: z
		.int()
		.min(-100_000)
		.max(100_000)
		.refine((n) => n !== 0, "not zero"),
	reason: z.string().trim().min(1).max(200),
});

export const TillCustomer = z.object({
	id: Id,
	name: z.string().nullable(),
	phone: z.string(),
	points: z.int(),
	visitCount: z.int(),
	program: LoyaltyProgram,
});

export const TillRedeem = z.object({
	rewardId: z.string().min(1).max(40),
	/** Links the order to this guest if it isn't yet. */
	customerId: Id,
});
export const TillRedeemResponse = z.object({
	paymentId: Id,
	amount: Minor,
	points: z.int(),
});

export type LoyaltyReward = z.infer<typeof LoyaltyReward>;
export type LoyaltyProgram = z.infer<typeof LoyaltyProgram>;
export type GuestPastOrder = z.infer<typeof GuestPastOrder>;
export type GuestProfile = z.infer<typeof GuestProfile>;
export type AdminCustomer = z.infer<typeof AdminCustomer>;
export type LoyaltyLedgerRow = z.infer<typeof LoyaltyLedgerRow>;
export type AdminCustomerDetail = z.infer<typeof AdminCustomerDetail>;
export type AdminCustomersQuery = z.infer<typeof AdminCustomersQuery>;
export type AdjustPoints = z.infer<typeof AdjustPoints>;
export type TillCustomer = z.infer<typeof TillCustomer>;
export type TillRedeem = z.infer<typeof TillRedeem>;
export type TillRedeemResponse = z.infer<typeof TillRedeemResponse>;
