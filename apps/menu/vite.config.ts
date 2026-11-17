import { existsSync } from "node:fs";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

// The SSR loaders read process.env.BITE_API_URL; Vite only exposes VITE_*
// vars, so load apps/menu/.env (written by `pnpm dev:setup`) ourselves.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
	plugins: [reactRouter()],
	server: { port: 5174, strictPort: true, host: true },
});
