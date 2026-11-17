import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [reactRouter()],
	server: {
		port: 5173,
		strictPort: true,
		host: true,
		// Dev: the API is same-origin through this proxy (VITE_API_URL=/), so
		// the session cookie works on localhost and on a LAN IP alike.
		proxy: { "/v1": process.env.BITE_API_URL ?? "http://localhost:3000" },
	},
});
