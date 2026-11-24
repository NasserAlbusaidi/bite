import type { UploadedImage } from "@bite/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";
import {
	CONTENT_TYPE,
	MAX_UPLOAD_BYTES,
	parseKey,
	sniffImage,
} from "../lib/uploads.js";
import { requireOrgWide } from "../middleware/admin-auth.js";

const tooBig = () => {
	throw new ApiError("bad_request", "image is larger than 5 MB", {
		maxBytes: MAX_UPLOAD_BYTES,
	});
};

/**
 * POST /v1/admin/uploads: the raw image is the body. An image/* content type
 * (not a form post) means a cross-site page can't send it without a CORS
 * preflight, which ADMIN_ORIGINS refuses. The file always lands under the
 * caller's own org; nothing in the request can name another one.
 */
export const adminUploadRoutes = new Hono<AppEnv>().post(
	"/uploads",
	bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: tooBig }),
	async (c) => {
		requireOrgWide(c);
		const { uploads, publicApiUrl } = c.var.deps;
		if (!uploads) throw new ApiError("not_found", "uploads are not set up");
		const declared = (c.req.header("content-type") ?? "").split(";")[0]?.trim();
		if (!declared || !Object.values(CONTENT_TYPE).includes(declared)) {
			throw new ApiError(
				"bad_request",
				"send a JPEG, PNG, WebP or GIF with its image content type",
			);
		}
		const bytes = new Uint8Array(await c.req.arrayBuffer());
		if (bytes.byteLength > MAX_UPLOAD_BYTES) tooBig();
		const type = sniffImage(bytes);
		if (!type) throw new ApiError("bad_request", "that file isn't an image");
		const key = await uploads.put(c.var.admin.orgId, type, bytes);
		const base = publicApiUrl ?? new URL(c.req.url).origin;
		const body: UploadedImage = {
			url: new URL(`/v1/uploads/${key}`, base).toString(),
		};
		return c.json(body, 201);
	},
);

/**
 * GET /v1/uploads/:org/:file. Public on purpose: guests' phones load product
 * photos from here. Names are random UUIDs and only ever served as images.
 */
export const publicUploadRoutes = new Hono<AppEnv>().get(
	"/:org/:file",
	async (c) => {
		const key = `${c.req.param("org")}/${c.req.param("file")}`;
		const parsed = parseKey(key);
		const store = c.var.deps.uploads;
		const bytes = parsed && store ? await store.get(key) : null;
		if (!parsed || !bytes) throw new ApiError("not_found", "no such image");
		return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
			"content-type": CONTENT_TYPE[parsed.type],
			"cache-control": "public, max-age=31536000, immutable",
			"x-content-type-options": "nosniff",
			"content-security-policy": "default-src 'none'; sandbox",
			"cross-origin-resource-policy": "cross-origin",
		});
	},
);
