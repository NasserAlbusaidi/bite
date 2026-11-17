import type { Db } from "@bite/db";
import { PgBoss } from "pg-boss";
import {
	expireGroupCarts,
	expireGuestOrders,
	pruneSyncMutations,
} from "./tasks.js";

type Task = (db: Db, now: Date) => Promise<number>;

/** Queue name -> cron (Asia/Muscat) and the task it runs. */
export const SCHEDULES: Record<string, { cron: string; task: Task }> = {
	"expire-guest-orders": { cron: "* * * * *", task: expireGuestOrders },
	"expire-group-carts": { cron: "*/5 * * * *", task: expireGroupCarts },
	"prune-sync-mutations": {
		cron: "17 4 * * *",
		task: (db, now) => pruneSyncMutations(db, now),
	},
};

/**
 * Start pg-boss on the system connection, (re)register the schedules and
 * work the queues. pg-boss keeps its own tables in the `pgboss` schema,
 * which bite_system may create (sql/bootstrap-roles.sql).
 */
export async function startWorker(opts: {
	connectionString: string;
	db: Db;
	now?: () => Date;
	log?: (msg: string) => void;
}) {
	const boss = new PgBoss({
		connectionString: opts.connectionString,
		schema: "pgboss",
	});
	boss.on("error", (err) => opts.log?.(`pg-boss error: ${String(err)}`));
	await boss.start();
	for (const [name, { cron, task }] of Object.entries(SCHEDULES)) {
		await boss.createQueue(name);
		await boss.schedule(name, cron, null, { tz: "Asia/Muscat" });
		await boss.work(name, async () => {
			const n = await task(opts.db, opts.now?.() ?? new Date());
			if (n > 0) opts.log?.(`${name}: ${n}`);
			return { n };
		});
	}
	return boss;
}
