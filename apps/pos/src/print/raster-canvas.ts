import { toMono } from "./escpos.js";
import type { Rasterizer } from "./printers.js";
import type { TicketBlock } from "./ticket.js";

/**
 * Browser rasterizer: lays the ticket out on a canvas so the web view handles
 * Arabic shaping and RTL, then thresholds to 1-bit. Runs on the tablet only
 * (Node has no canvas), so it is kept thin; layout rules are in ticket.ts.
 */
const FONT = `"Noto Sans Arabic", "Noto Sans", system-ui, sans-serif`;
const BASE_PX = 24;
const PAD = 8;

export const canvasRasterizer: Rasterizer = async (ticket, width) => {
	const lineHeight = (b: TicketBlock) =>
		b.kind === "feed"
			? b.lines * BASE_PX
			: b.kind === "rule"
				? BASE_PX / 2
				: (b.kind === "text" && b.size === 2 ? 2 : 1) * BASE_PX * 1.3;
	const height = Math.ceil(
		ticket.blocks.reduce((h, b) => h + lineHeight(b), PAD * 2),
	);

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D is not available");
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, width, height);
	ctx.fillStyle = "#000";
	ctx.textBaseline = "top";
	ctx.direction = ticket.dir;

	const rtl = ticket.dir === "rtl";
	const startX = rtl ? width - PAD : PAD;
	const endX = rtl ? PAD : width - PAD;
	let y = PAD;
	for (const b of ticket.blocks) {
		const h = lineHeight(b);
		if (b.kind === "text") {
			ctx.font = `${b.bold ? "700" : "400"} ${(b.size ?? 1) * BASE_PX}px ${FONT}`;
			const align = b.align ?? "start";
			ctx.textAlign = align === "center" ? "center" : align;
			ctx.fillText(
				b.text,
				align === "center" ? width / 2 : align === "start" ? startX : endX,
				y,
				width - PAD * 2,
			);
		} else if (b.kind === "pair") {
			ctx.font = `${b.bold ? "700" : "400"} ${BASE_PX}px ${FONT}`;
			ctx.textAlign = "start";
			ctx.fillText(b.left, startX, y);
			ctx.textAlign = "end";
			ctx.fillText(b.right, endX, y);
		} else if (b.kind === "rule") {
			ctx.fillRect(PAD, y + h / 2 - 1, width - PAD * 2, 2);
		}
		y += h;
	}
	const data = ctx.getImageData(0, 0, width, height);
	return toMono(data.data, width, height);
};
