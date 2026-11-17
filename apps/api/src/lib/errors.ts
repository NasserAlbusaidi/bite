import type { ErrorBody, ErrorCode } from "@bite/contracts";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
	bad_request: 400,
	unauthenticated: 401,
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
	console.error(err);
	return c.json(errorBody(new ApiError("internal", "internal error")), 500);
}

export function notFound(c: Context) {
	return c.json(errorBody(new ApiError("not_found", "no such route")), 404);
}
