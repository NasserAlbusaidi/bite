import type { Db } from "@bite/db";
import { sql } from "@bite/db/orm";
import { v7 as uuidv7 } from "uuid";
import type { SessionCtx } from "../env.js";

export const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** platform_admins is readable by the system role only (migration 0017). */
export async function isPlatformAdmin(sys: Db, userId: string) {
	const rows = (await sys.execute(
		sql`select 1 as ok from platform_admins where user_id = ${userId}`,
	)) as unknown as unknown[];
	return rows.length > 0;
}

/** One row in the org's audit log for a platform action. */
export async function audit(
	sys: Db,
	orgId: string,
	who: SessionCtx,
	action: string,
	data: Record<string, unknown>,
) {
	await sys.execute(sql`
		insert into audit_log (id, org_id, action, entity_type, entity_id, data)
		values (${uuidv7()}, ${orgId}, ${action}, 'org', ${orgId},
			${JSON.stringify({ ...data, by: who.email, userId: who.userId })}::jsonb)`);
}
