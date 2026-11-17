import { defineConfig } from "vitest/config";

// Coverage is a CI gate for the money engine. Thresholds sit just under the
// current numbers so a regression fails; raise them, never lower them.
export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		coverage: {
			enabled: true,
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/test-helpers.ts"],
			reporter: ["text-summary", "json-summary"],
			thresholds: {
				statements: 92,
				branches: 87,
				functions: 95,
				lines: 94,
				"src/money.ts": {
					statements: 92,
					branches: 88,
					functions: 92,
					lines: 97,
				},
				"src/pricing.ts": {
					statements: 97,
					branches: 95,
					functions: 100,
					lines: 97,
				},
				"src/promotions.ts": {
					statements: 95,
					branches: 92,
					functions: 100,
					lines: 99,
				},
				"src/tenders.ts": {
					statements: 85,
					branches: 85,
					functions: 90,
					lines: 90,
				},
				"src/allocate.ts": {
					statements: 90,
					branches: 84,
					functions: 100,
					lines: 90,
				},
			},
		},
	},
});
