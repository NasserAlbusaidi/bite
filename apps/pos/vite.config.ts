import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	// Capacitor loads the bundle from the device filesystem, so paths must be relative.
	base: "./",
	build: { outDir: "dist", target: "es2022" },
	test: { environment: "node" },
});
