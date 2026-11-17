import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { ApiError } from "./errors.js";

/** zValidator that fails with our ErrorBody envelope instead of Hono's default. */
export const validate = <T extends ZodType, K extends keyof ValidationTargets>(
	target: K,
	schema: T,
) =>
	zValidator(target, schema, (result) => {
		if (!result.success) {
			throw new ApiError("bad_request", "invalid request", result.error.issues);
		}
	});
