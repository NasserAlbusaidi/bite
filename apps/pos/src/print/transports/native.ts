import type { PrinterTransport } from "../printers.js";

/**
 * Seam between PrintService and native code. TCP (port 9100) is implemented
 * for Android and iOS in plugins/printer-socket (see native-bridge.ts).
 * Bluetooth is optional because it differs per platform: Classic SPP on
 * Android, BLE (or MFi) on iPad. LAN printers are the recommended setup since
 * one printer works with both kinds of tablet.
 */
export interface NativePrinterBridge {
	tcpSend(host: string, port: number, bytes: Uint8Array): Promise<void>;
	bluetoothSend?(address: string, bytes: Uint8Array): Promise<void>;
}

export function tcpTransport(bridge: NativePrinterBridge): PrinterTransport {
	return {
		async send(printer, bytes) {
			if (printer.transport.type !== "tcp")
				throw new Error("not a tcp printer");
			await bridge.tcpSend(
				printer.transport.host,
				printer.transport.port,
				bytes,
			);
		},
	};
}

export function bluetoothTransport(
	bridge: NativePrinterBridge,
): PrinterTransport | undefined {
	const send = bridge.bluetoothSend;
	if (!send) return undefined;
	return {
		async send(printer, bytes) {
			if (printer.transport.type !== "bluetooth")
				throw new Error("not a bluetooth printer");
			await send(printer.transport.address, bytes);
		},
	};
}
