import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	// basicSsl: dev only (serve). A tablet on the LAN needs HTTPS: offline PIN
	// unlock uses crypto.subtle, which browsers only expose in secure contexts.
	plugins: [react(), basicSsl()],
	// Capacitor loads the bundle from the device filesystem, so paths must be relative.
	base: "./",
	build: { outDir: "dist", target: "es2022" },
	server: {
		port: 5175,
		strictPort: true,
		host: true,
		// Pair with this page's own address as the server URL; /v1 goes to the API.
		proxy: { "/v1": process.env.BITE_API_URL ?? "http://localhost:3000" },
	},
	test: { environment: "node" },
});
