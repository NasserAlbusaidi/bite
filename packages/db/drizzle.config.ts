import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/schema/index.ts",
	out: "./migrations",
	entities: { roles: { provider: "" } },
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "postgres://localhost/bite",
	},
});
