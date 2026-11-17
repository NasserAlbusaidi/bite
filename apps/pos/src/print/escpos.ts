import type { Ticket } from "./ticket.js";

/**
 * ESC/POS encoders. Two modes:
 * - text: tiny, fast, ASCII only. Good for English kitchen tickets.
 * - raster: the ticket is drawn on a canvas by the web view (which does
 *   Arabic shaping and bidi properly) and sent as a 1-bit image. Thermal
 *   printer Arabic code pages are a mess, so Arabic always goes raster.
 */
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const INIT = [ESC, 0x40];
const CUT = [GS, 0x56, 0x42, 0x00]; // feed + partial cut
const DRAWER = [ESC, 0x70, 0x00, 0x19, 0xfa]; // pulse pin 2

const ALIGN = { start: 0, center: 1, end: 2 } as const;

class Bytes {
	private readonly out: number[] = [];
	push(...b: number[]) {
		for (const x of b) this.out.push(x);
		return this;
	}
	ascii(s: string) {
		for (let i = 0; i < s.length; i++) {
			const c = s.charCodeAt(i);
			this.out.push(c >= 0x20 && c <= 0x7e ? c : 0x3f); // "?" for anything else
		}
		return this;
	}
	done() {
		return Uint8Array.from(this.out);
	}
}

export function encodeText(t: Ticket, opts: { columns: number }): Uint8Array {
	const cols = opts.columns;
	const b = new Bytes().push(...INIT);
	if (t.openDrawer) b.push(...DRAWER);
	for (const blk of t.blocks) {
		switch (blk.kind) {
			case "text": {
				const size = blk.size ?? 1;
				b.push(ESC, 0x61, ALIGN[blk.align ?? "start"]);
				b.push(ESC, 0x45, blk.bold ? 1 : 0);
				b.push(GS, 0x21, size === 2 ? 0x11 : 0x00);
				for (const line of wrap(blk.text, Math.floor(cols / size)))
					b.ascii(line).push(LF);
				b.push(GS, 0x21, 0x00, ESC, 0x45, 0, ESC, 0x61, 0);
				break;
			}
			case "pair": {
				b.push(ESC, 0x45, blk.bold ? 1 : 0);
				b.ascii(pair(blk.left, blk.right, cols)).push(LF);
				b.push(ESC, 0x45, 0);
				break;
			}
			case "rule":
				b.ascii("-".repeat(cols)).push(LF);
				break;
			case "feed":
				b.push(ESC, 0x64, Math.max(0, Math.min(255, blk.lines)));
				break;
		}
	}
	if (t.cut) b.push(...CUT);
	return b.done();
}

/** "Label ........ value", truncating the label if it doesn't fit. */
export function pair(left: string, right: string, cols: number): string {
	const room = cols - right.length - 1;
	if (room <= 0) return right.slice(0, cols);
	const l = left.length > room ? `${left.slice(0, room - 1)}~` : left;
	return `${l}${" ".repeat(cols - l.length - right.length)}${right}`;
}

export function wrap(text: string, cols: number): string[] {
	if (cols <= 0) return [text];
	const out: string[] = [];
	let line = "";
	for (const word of text.split(" ")) {
		if (!line) line = word;
		else if (line.length + 1 + word.length <= cols) line += ` ${word}`;
		else {
			out.push(line);
			line = word;
		}
		while (line.length > cols) {
			out.push(line.slice(0, cols));
			line = line.slice(cols);
		}
	}
	out.push(line);
	return out;
}

/** 1-bit image, row-major, 1 = black. Width is in dots. */
export type MonoBitmap = { width: number; height: number; bits: Uint8Array };

/** RGBA (canvas ImageData) to 1-bit with a luminance threshold. Pure, testable. */
export function toMono(
	rgba: Uint8ClampedArray | Uint8Array,
	width: number,
	height: number,
	threshold = 160,
): MonoBitmap {
	const bits = new Uint8Array(width * height);
	for (let i = 0; i < width * height; i++) {
		const r = rgba[i * 4] ?? 255;
		const g = rgba[i * 4 + 1] ?? 255;
		const bl = rgba[i * 4 + 2] ?? 255;
		const a = (rgba[i * 4 + 3] ?? 255) / 255;
		// Transparent counts as white paper.
		const lum = (0.299 * r + 0.587 * g + 0.114 * bl) * a + 255 * (1 - a);
		bits[i] = lum < threshold ? 1 : 0;
	}
	return { width, height, bits };
}

/**
 * GS v 0 raster, sent in bands so printers with small buffers don't choke.
 */
export function encodeRaster(
	img: MonoBitmap,
	opts: { cut: boolean; openDrawer?: boolean; bandHeight?: number },
): Uint8Array {
	const bytesPerRow = Math.ceil(img.width / 8);
	const band = opts.bandHeight ?? 256;
	const b = new Bytes().push(...INIT);
	if (opts.openDrawer) b.push(...DRAWER);
	for (let y0 = 0; y0 < img.height; y0 += band) {
		const h = Math.min(band, img.height - y0);
		b.push(
			GS,
			0x76,
			0x30,
			0x00,
			bytesPerRow & 0xff,
			bytesPerRow >> 8,
			h & 0xff,
			h >> 8,
		);
		for (let y = y0; y < y0 + h; y++) {
			for (let xb = 0; xb < bytesPerRow; xb++) {
				let byte = 0;
				for (let bit = 0; bit < 8; bit++) {
					const x = xb * 8 + bit;
					if (x < img.width && img.bits[y * img.width + x]) byte |= 0x80 >> bit;
				}
				b.push(byte);
			}
		}
	}
	b.push(ESC, 0x64, 3);
	if (opts.cut) b.push(...CUT);
	return b.done();
}
