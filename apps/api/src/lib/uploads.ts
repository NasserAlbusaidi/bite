import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Product photos. Owners upload from the back office; guests load them from
 * the public /v1/uploads/:org/:file route. Files are keyed by org so one
 * tenant can never write into another's folder, and named by a random UUID
 * so nobody can guess or overwrite one.
 */
export type ImageType = "jpg" | "png" | "webp" | "gif";

export const CONTENT_TYPE: Record<ImageType, string> = {
	jpg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	gif: "image/gif",
};

/** 5 MB: a phone photo after the back office downsizes it is ~200 KB. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface UploadStore {
	put(orgId: string, type: ImageType, bytes: Uint8Array): Promise<string>;
	/** `key` is `<orgId>/<uuid>.<ext>`, already validated by the route. */
	get(key: string): Promise<Uint8Array | null>;
}

/** What the bytes really are, from their magic numbers. Never trust the header. */
export function sniffImage(b: Uint8Array): ImageType | null {
	const at = (i: number, ...xs: number[]) => xs.every((x, n) => b[i + n] === x);
	if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "jpg";
	if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
		return "png";
	if (
		b.length >= 12 &&
		at(0, 0x52, 0x49, 0x46, 0x46) &&
		at(8, 0x57, 0x45, 0x42, 0x50)
	)
		return "webp";
	if (
		b.length >= 6 &&
		at(0, 0x47, 0x49, 0x46, 0x38) &&
		(b[4] === 0x37 || b[4] === 0x39) &&
		b[5] === 0x61
	)
		return "gif";
	return null;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** `<orgId>/<uuid>.<ext>` and nothing else: no dots, slashes or traversal. */
export const KEY_PATTERN = new RegExp(
	`^(${UUID})/(${UUID})\\.(jpg|png|webp|gif)$`,
);

export function parseKey(
	key: string,
): { orgId: string; type: ImageType } | null {
	const m = KEY_PATTERN.exec(key);
	return m ? { orgId: m[1] as string, type: m[3] as ImageType } : null;
}

/** Files on local disk (UPLOAD_DIR). Fine for one API server, like the demo box. */
export function diskStore(dir: string): UploadStore {
	const root = resolve(dir);
	return {
		async put(orgId, type, bytes) {
			const key = `${orgId}/${randomUUID()}.${type}`;
			if (!parseKey(key)) throw new Error("bad upload key");
			await mkdir(join(root, orgId), { recursive: true });
			await writeFile(join(root, key), bytes, { flag: "wx" });
			return key;
		},
		async get(key) {
			if (!parseKey(key)) return null;
			try {
				return new Uint8Array(await readFile(join(root, key)));
			} catch {
				return null;
			}
		},
	};
}

/** In memory, for tests. */
export function memoryStore(): UploadStore & { size(): number } {
	const files = new Map<string, Uint8Array>();
	return {
		async put(orgId, type, bytes) {
			const key = `${orgId}/${randomUUID()}.${type}`;
			files.set(key, bytes);
			return key;
		},
		async get(key) {
			return files.get(key) ?? null;
		},
		size: () => files.size,
	};
}
