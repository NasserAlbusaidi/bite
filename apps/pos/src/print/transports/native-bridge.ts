import { PrinterSocket } from "@bite/capacitor-printer-socket";
import type { NativePrinterBridge } from "./native.js";

/** Android + iOS: raw TCP via our local Capacitor plugin (plugins/printer-socket). */
export const capacitorPrinterBridge: NativePrinterBridge = {
	async tcpSend(host, port, bytes) {
		await PrinterSocket.send({
			host,
			port,
			data: toBase64(bytes),
			timeoutMs: 5_000,
		});
	},
	// Bluetooth differs per platform (Classic on Android, BLE/MFi on iPad); not wired yet.
};

export function toBase64(bytes: Uint8Array): string {
	let s = "";
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(s);
}
