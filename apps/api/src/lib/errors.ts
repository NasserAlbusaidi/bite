import type { ErrorBody, ErrorCode } from "@bite/contracts";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
	bad_request: 400,
	unauthenticated: 401,
	plan_limit: 402,
	forbidden: 403,
	not_found: 404,
	conflict: 409,
	idempotency_mismatch: 422,
	unprocessable: 422,
	rate_limited: 429,
	internal: 500,
};

export class ApiError extends Error {
	constructor(
		readonly code: ErrorCode,
		message: string,
		readonly details?: unknown,
	) {
		super(message);
	}
	get status() {
		return STATUS[this.code];
	}
}

export function errorBody(err: ApiError): ErrorBody {
	return {
		error: {
			code: err.code,
			message: err.message,
			...(err.details === undefined ? {} : { details: err.details }),
		},
	};
}

export function onError(err: Error, c: Context) {
	if (err instanceof ApiError) return c.json(errorBody(err), err.status);
	if (err instanceof ZodError) {
		return c.json(
			errorBody(new ApiError("bad_request", "invalid request", err.issues)),
			400,
		);
	}
	const pg = pgError(err);
	// Composite (org_id, x_id) FKs: an id from another tenant, or one that
	// doesn't exist, lands here. Same answer for both, so nothing leaks.
	if (pg?.code === "23503" || pg?.code === "23514") {
		const msg =
			pg.code === "23503"
				? "references something that doesn't exist"
				: "violates a data rule";
		return c.json(
			errorBody(
				new ApiError("unprocessable", msg, { constraint: pg.constraint_name }),
			),
			422,
		);
	}
	console.error(err);
	return c.json(errorBody(new ApiError("internal", "internal error")), 500);
}

export function notFound(c: Context) {
	return c.json(errorBody(new ApiError("not_found", "no such route")), 404);
}

type PgError = { code?: string; constraint_name?: string };

/** The postgres.js error, whether thrown directly or wrapped by drizzle. */
export function pgError(err: unknown): PgError | undefined {
	const e = err as PgError & { cause?: unknown };
	if (e?.code) return e;
	const cause = e?.cause as PgError | undefined;
	return cause?.code ? cause : undefined;
}
