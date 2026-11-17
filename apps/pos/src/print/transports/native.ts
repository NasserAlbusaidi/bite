import type { PrinterTransport } from "../printers.js";

/**
 * TCP (port 9100) and Bluetooth need a native Capacitor plugin. Which plugin
 * depends on Android vs iPad (iPad needs MFi or BLE printers; Android can do
 * Bluetooth Classic). Until that's decided this bridge is the seam: register
 * an implementation at startup and the PrintService picks it up.
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
