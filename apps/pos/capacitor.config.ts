import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Ships on Android and iPad. Nothing in src/ is platform specific outside the
 * SQLite driver and the printer bridge. Run `pnpm exec cap sync` after builds.
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
