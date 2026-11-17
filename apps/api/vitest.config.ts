import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Integration files share one database and reset it in beforeAll.
		fileParallelism: false,
		testTimeout: 20_000,
		hookTimeout: 60_000,
		// A test with no expect() proves nothing (e.g. an empty cross-tenant case).
		expect: { requireAssertions: true },
	},
});
