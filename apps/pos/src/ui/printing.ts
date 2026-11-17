import { Capacitor } from "@capacitor/core";
import type { SqlExecutor } from "../db/driver.js";
import { kvGet, kvSet } from "../db/kv.js";
import { type PrinterConfig, PrintService } from "../print/printers.js";
import { canvasRasterizer } from "../print/raster-canvas.js";
import { consoleTransport } from "../print/transports/console.js";
import { tcpTransport } from "../print/transports/native.js";

const KEY = "printers";

export async function loadPrinters(db: SqlExecutor): Promise<PrinterConfig[]> {
	const raw = await kvGet(db, KEY);
	return raw ? (JSON.parse(raw) as PrinterConfig[]) : [];
}

export async function savePrinters(db: SqlExecutor, printers: PrinterConfig[]) {
	await kvSet(db, KEY, JSON.stringify(printers));
}

/** Printers live in a mutable holder so Settings changes apply without a restart. */
export async function createPrintService(db: SqlExecutor) {
	const holder = { printers: await loadPrinters(db) };
	let tcp = undefined as ReturnType<typeof tcpTransport> | undefined;
	if (Capacitor.isNativePlatform()) {
		const { capacitorPrinterBridge } = await import(
			"../print/transports/native-bridge.js"
		);
		tcp = tcpTransport(capacitorPrinterBridge);
	}
	const service = new PrintService({
		printers: () => holder.printers,
		// In a desktop browser there is no socket: "tcp" printers fall back to the console log.
		transports: {
			tcp: tcp ?? consoleTransport,
			bluetooth: undefined,
			console: consoleTransport,
		},
		rasterize: canvasRasterizer,
	});
	return { service, holder };
}
