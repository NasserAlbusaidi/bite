import { defineConfig } from "vitest/config";

// Separate from vite.config.ts: the React Router plugin must not run under Vitest.
export default defineConfig({
	test: {
		include: ["app/**/*.test.{ts,tsx}"],
		expect: { requireAssertions: true },
	},
});
