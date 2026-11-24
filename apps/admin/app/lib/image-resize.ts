/**
 * Shrink a photo in the browser before it's uploaded: phone photos are 3-8 MB
 * and 4000px wide, the guest menu shows them at most ~800px. Longest side
 * 1600px, WebP (JPEG where the browser can't encode WebP). GIFs and anything
 * the browser can't decode go up untouched; the server checks them anyway.
 */
export async function shrinkImage(file: Blob, maxSide = 1600): Promise<Blob> {
	if (file.type === "image/gif" || typeof createImageBitmap !== "function")
		return file;
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return file;
	}
	const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
	const w = Math.round(bitmap.width * scale);
	const h = Math.round(bitmap.height * scale);
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) return file;
	ctx.drawImage(bitmap, 0, 0, w, h);
	bitmap.close();
	const encode = (type: string) =>
		new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.85));
	const out = (await encode("image/webp")) ?? (await encode("image/jpeg"));
	if (!out || !/^image\/(webp|jpeg)$/.test(out.type)) {
		const jpeg = await encode("image/jpeg");
		return jpeg && jpeg.size < file.size ? jpeg : file;
	}
	// Never upload something bigger than what we started with.
	return out.size < file.size || scale < 1 ? out : file;
}
