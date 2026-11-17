import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android vs iPad is still undecided, so no native project is checked in yet.
 * `pnpm exec cap add android` / `cap add ios` once Nasser picks; nothing in
 * src/ is platform specific outside the driver/transport adapters.
 */
const config: CapacitorConfig = {
	appId: "app.bite.pos",
	appName: "Bite POS",
	webDir: "dist",
	plugins: {
		CapacitorSQLite: {
			iosDatabaseLocation: "Library/CapacitorDatabase",
			androidIsEncryption: false,
		},
	},
};

export default config;
