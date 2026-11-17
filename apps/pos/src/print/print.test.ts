import { minor } from "@bite/core";
import { describe, expect, it } from "vitest";
import { encodeRaster, encodeText, pair, toMono, wrap } from "./escpos.js";
import { ticketLabels } from "./labels.js";
import { type PrinterConfig, PrintService } from "./printers.js";
import {
	isAsciiOnly,
	kitchenTicket,
	receipt,
	type TicketOrderInput,
} from "./ticket.js";

const order: TicketOrderInput = {
	ticketNumber: "A-007",
	type: "takeaway",
	placedAt: new Date("2026-11-17T09:05:00Z"),
	timeZone: "Asia/Muscat",
	lines: [
		{
			quantity: 2,
			name: "Flat white",
			modifiers: ["Oat milk"],
			lineTotal: minor(3600),
			note: "nut allergy",
		},
		{
			quantity: 1,
			name: "Croissant",
			modifiers: [],
			lineTotal: minor(1200),
			voided: true,
		},
	],
	note: "No sugar",
};

const ascii = (b: Uint8Array) => Buffer.from(b).toString("latin1");

describe("kitchen ticket", () => {
	it("shows ticket, local time, notes loud, voids marked, no prices", () => {
		const t = kitchenTicket(order, ticketLabels("en"));
		const text = ascii(encodeText(t, { columns: 48 }));
		expect(text).toContain("A-007");
		expect(text).toContain("Takeaway");
		expect(text).toContain("17/11/2026, 13:05"); // Muscat is UTC+4
		expect(text).toContain("2x Flat white");
		expect(text).toContain("+ Oat milk");
		expect(text).toContain("** Note: nut allergy");
		expect(text).toContain("VOID 1x Croissant");
		expect(text).toContain("** Order note: No sugar");
		expect(text).not.toContain("3.600");
		expect(isAsciiOnly(t)).toBe(true);
	});

	it("Arabic labels force raster mode", () => {
		expect(isAsciiOnly(kitchenTicket(order, ticketLabels("ar"), "rtl"))).toBe(
			false,
		);
	});
});

describe("receipt", () => {
	it("prints baisa as 3-decimal OMR and skips voided lines", () => {
		const t = receipt(
			{
				...order,
				locationName: "Sourdough",
				vatNumber: "OM123",
				subtotal: minor(3600),
				discountTotal: minor(0),
				taxTotal: minor(171),
				total: minor(3600),
				payments: [{ label: "Cash", amount: minor(5000) }],
				change: minor(1400),
				openDrawer: true,
			},
			ticketLabels("en"),
		);
		const text = ascii(encodeText(t, { columns: 32 }));
		expect(text).toContain("Total");
		expect(text).toContain("3.600 OMR");
		expect(text).toContain("0.171 OMR");
		expect(text).toContain("1.400 OMR");
		expect(text).not.toContain("Croissant");
		expect(text).not.toContain("Discount");
		// Drawer kick right after init.
		expect([...encodeText(t, { columns: 32 }).slice(2, 7)]).toEqual([
			0x1b, 0x70, 0x00, 0x19, 0xfa,
		]);
	});
});

describe("escpos", () => {
	it("pads pairs to the column width and truncates long labels", () => {
		expect(pair("Total", "4.500", 20)).toBe("Total          4.500");
		expect(pair("A very long product name", "1.000", 16)).toBe(
			"A very lo~ 1.000",
		);
	});

	it("wraps on words and hard-splits long words", () => {
		expect(wrap("two flat whites please", 10)).toEqual([
			"two flat",
			"whites",
			"please",
		]);
		expect(wrap("abcdefghijkl", 5)).toEqual(["abcde", "fghij", "kl"]);
	});

	it("replaces non-ASCII in text mode instead of sending garbage", () => {
		const bytes = encodeText(
			{ blocks: [{ kind: "text", text: "قهوة" }], dir: "ltr", cut: false },
			{ columns: 32 },
		);
		expect(ascii(bytes)).toContain("????");
	});

	it("thresholds RGBA to 1-bit, transparent = paper", () => {
		const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0]);
		expect([...toMono(rgba, 3, 1).bits]).toEqual([1, 0, 0]);
	});

	it("encodes GS v 0 raster with MSB-first bits and bands", () => {
		const img = { width: 9, height: 3, bits: new Uint8Array(27) };
		img.bits[0] = 1; // (0,0)
		img.bits[8] = 1; // (8,0) -> second byte, MSB
		const out = encodeRaster(img, { cut: false, bandHeight: 2 });
		// init(2) + header(8) + 2 rows * 2 bytes, then header(8) + 1 row * 2 bytes
		expect([...out.slice(2, 10)]).toEqual([0x1d, 0x76, 0x30, 0, 2, 0, 2, 0]);
		expect([...out.slice(10, 12)]).toEqual([0x80, 0x80]);
		expect([...out.slice(14, 22)]).toEqual([0x1d, 0x76, 0x30, 0, 2, 0, 1, 0]);
	});
});

describe("PrintService", () => {
	const printer = (over: Partial<PrinterConfig> = {}): PrinterConfig => ({
		id: "p1",
		name: "Kitchen",
		roles: ["kitchen"],
		columns: 48,
		dots: 576,
		mode: "auto",
		transport: { type: "console" },
		...over,
	});
	const ticket = kitchenTicket(order, ticketLabels("en"));

	it("routes by role and never throws when a printer fails", async () => {
		const sent: string[] = [];
		let fails = 0;
		const svc = new PrintService({
			printers: () => [
				printer(),
				printer({ id: "p2", roles: ["receipt"] }),
				printer({
					id: "p3",
					transport: { type: "tcp", host: "10.0.0.9", port: 9100 },
				}),
			],
			transports: {
				console: { send: async (p) => void sent.push(p.id) },
				tcp: {
					send: async () => {
						fails++;
						throw new Error("ECONNREFUSED");
					},
				},
				bluetooth: undefined,
			},
			rasterize: async () => {
				throw new Error("no canvas");
			},
			sleep: async () => {},
		});
		const res = await svc.print("kitchen", ticket);
		expect(sent).toEqual(["p1"]);
		expect(res).toEqual([
			{ printerId: "p1", ok: true },
			{ printerId: "p3", ok: false, error: "ECONNREFUSED" },
		]);
		expect(fails).toBe(3); // 1 + 2 retries
	});

	it("uses the rasterizer for Arabic and reports a missing transport", async () => {
		let rastered = 0;
		const svc = new PrintService({
			printers: () => [
				printer(),
				printer({ id: "bt", transport: { type: "bluetooth", address: "x" } }),
			],
			transports: {
				console: { send: async () => {} },
				tcp: undefined,
				bluetooth: undefined,
			},
			rasterize: async (_t, w) => {
				rastered++;
				return { width: w, height: 1, bits: new Uint8Array(w) };
			},
		});
		const res = await svc.print(
			"kitchen",
			kitchenTicket(order, ticketLabels("ar"), "rtl"),
		);
		expect(rastered).toBe(1);
		expect(res[1]).toEqual({
			printerId: "bt",
			ok: false,
			error: "No bluetooth transport on this device",
		});
	});
});
