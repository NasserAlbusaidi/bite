import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Connect as the runtime role (bite_app). Never connect the API as the
 * table owner: the owner bypasses RLS.
 */
export function createDb(
	url: string,
	opts: postgres.Options<Record<string, postgres.PostgresType>> = {},
) {
	const client = postgres(url, { prepare: false, ...opts });
	return { db: drizzle(client, { schema }), client };
}

/**
 * The only way to touch tenant data. Opens a transaction and sets
 * app.org_id with SET LOCAL semantics, so the setting dies with the
 * transaction and is safe behind a transaction-mode pooler.
 */
export async function withTenant<T>(
	db: Db,
	orgId: string,
	fn: (tx: Tx) => Promise<T>,
): Promise<T> {
	if (!UUID_RE.test(orgId)) throw new Error("withTenant: invalid org id");
	return db.transaction(async (tx) => {
		await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
		return fn(tx);
	});
}
