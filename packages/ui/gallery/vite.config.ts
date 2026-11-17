import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev-only component gallery: pnpm --filter @bite/ui gallery
export default defineConfig({
	plugins: [react()],
	base: "./",
	server: { port: 5180 },
	build: { outDir: "../dist-gallery", emptyOutDir: true },
});
