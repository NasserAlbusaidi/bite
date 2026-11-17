import { encodeRaster, encodeText, type MonoBitmap } from "./escpos.js";
import { isAsciiOnly, type Ticket } from "./ticket.js";

/**
 * Printer setup is per device and per role, not one global printer like the
 * legacy PrintNode config. A tablet sends straight to printers on the shop
 * LAN or over Bluetooth, so printing keeps working with the internet down.
 */
export type PrinterRole = "receipt" | "kitchen";

export type PrinterConfig = {
	id: string;
	name: string;
	roles: PrinterRole[];
	/** Characters per line in text mode: 32 for 58mm paper, 48 for 80mm. */
	columns: 32 | 42 | 48;
	/** Printable dots per line for raster: 384 (58mm) or 576 (80mm). */
	dots: 384 | 576;
	/** "auto" = text when the ticket is plain ASCII, raster otherwise (Arabic). */
	mode: "auto" | "text" | "raster";
	transport:
		| { type: "tcp"; host: string; port: number }
		| { type: "bluetooth"; address: string }
		| { type: "console" };
};

export interface PrinterTransport {
	send(printer: PrinterConfig, bytes: Uint8Array): Promise<void>;
}

/** Draws a ticket to a 1-bit image. The browser implementation lives in raster-canvas.ts. */
export type Rasterizer = (
	ticket: Ticket,
	widthDots: number,
) => Promise<MonoBitmap>;

export type PrintResult =
	| { printerId: string; ok: true }
	| { printerId: string; ok: false; error: string };

export class PrintService {
	constructor(
		private readonly deps: {
			printers: () => PrinterConfig[];
			transports: Record<
				PrinterConfig["transport"]["type"],
				PrinterTransport | undefined
			>;
			rasterize: Rasterizer;
			retries?: number;
			sleep?: (ms: number) => Promise<void>;
		},
	) {}

	/**
	 * Print to every printer with this role. Never throws: a jammed printer
	 * must not fail a sale. Callers show the failures and offer a reprint.
	 */
	async print(role: PrinterRole, ticket: Ticket): Promise<PrintResult[]> {
		const targets = this.deps.printers().filter((p) => p.roles.includes(role));
		return Promise.all(targets.map((p) => this.printTo(p, ticket)));
	}

	async printTo(printer: PrinterConfig, ticket: Ticket): Promise<PrintResult> {
		const transport = this.deps.transports[printer.transport.type];
		if (!transport) {
			return {
				printerId: printer.id,
				ok: false,
				error: `No ${printer.transport.type} transport on this device`,
			};
		}
		let bytes: Uint8Array;
		try {
			bytes = await this.encode(printer, ticket);
		} catch (err) {
			return { printerId: printer.id, ok: false, error: message(err) };
		}
		const retries = this.deps.retries ?? 2;
		const sleep =
			this.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
		let lastError = "";
		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				await transport.send(printer, bytes);
				return { printerId: printer.id, ok: true };
			} catch (err) {
				lastError = message(err);
				if (attempt < retries) await sleep(500 * (attempt + 1));
			}
		}
		return { printerId: printer.id, ok: false, error: lastError };
	}

	private async encode(
		printer: PrinterConfig,
		ticket: Ticket,
	): Promise<Uint8Array> {
		const raster =
			printer.mode === "raster" ||
			(printer.mode === "auto" && !isAsciiOnly(ticket));
		if (!raster) return encodeText(ticket, { columns: printer.columns });
		const img = await this.deps.rasterize(ticket, printer.dots);
		return encodeRaster(img, {
			cut: ticket.cut,
			...(ticket.openDrawer && { openDrawer: true }),
		});
	}
}

function message(err: unknown) {
	return err instanceof Error ? err.message : String(err);
}
