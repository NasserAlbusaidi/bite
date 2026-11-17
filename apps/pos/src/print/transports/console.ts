import type { PrinterTransport } from "../printers.js";

/** Dev transport: logs what would be printed. Lets the app run in a desktop browser. */
export const consoleTransport: PrinterTransport = {
	async send(printer, bytes) {
		console.info(`[print] ${printer.name}: ${bytes.length} bytes`);
	},
};
