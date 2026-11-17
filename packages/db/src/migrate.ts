import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Run migrations as the schema owner (never as bite_app). */
export async function runMigrations(ownerUrl: string): Promise<void> {
	const client = postgres(ownerUrl, { max: 1, onnotice: () => {} });
	try {
		await migrate(drizzle(client), {
			// fileURLToPath, not .pathname: on Windows .pathname is "/C:/...".
			migrationsFolder: fileURLToPath(
				new URL("../migrations", import.meta.url),
			),
		});
	} finally {
		await client.end();
	}
}
