import { z } from "zod";

/**
 * Every non-2xx response has this body. `code` is stable and machine-read;
 * `message` is for logs and developers, never shown raw to guests.
 */
export const ErrorCode = z.enum([
	"bad_request", // 400, body failed validation (details = zod issues)
	"unauthenticated", // 401, missing/invalid/revoked token
	"plan_limit", // 402, the org's plan doesn't allow it (details = PlanLimitDetails)
	"forbidden", // 403, authenticated but role not allowed
	"not_found", // 404, includes rows hidden by tenancy
	"conflict", // 409, version mismatch
	"idempotency_mismatch", // 422, same key, different payload
	"unprocessable", // 422, domain rule broken (invalid transition, overpay)
	"rate_limited", // 429
	"internal", // 500
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorBody = z.object({
	error: z.object({
		code: ErrorCode,
		message: z.string(),
		details: z.unknown().optional(),
	}),
});
export type ErrorBody = z.infer<typeof ErrorBody>;
