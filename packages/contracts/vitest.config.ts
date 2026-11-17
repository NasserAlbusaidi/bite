import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// A test with no expect() proves nothing.
		expect: { requireAssertions: true },
	},
});
