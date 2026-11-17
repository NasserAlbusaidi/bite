export interface PrinterSocketPlugin {
	/**
	 * Open a TCP connection, write the bytes, close. One job per connection:
	 * thermal printers handle that best and nothing leaks if the app is killed.
	 * Rejects on connect/write failure or timeout.
	 */
	send(options: {
		host: string;
		port: number;
		/** Base64 of the raw ESC/POS bytes. */
		data: string;
		timeoutMs?: number;
	}): Promise<void>;
}

export declare const PrinterSocket: PrinterSocketPlugin;
