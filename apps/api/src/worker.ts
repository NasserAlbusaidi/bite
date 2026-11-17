import { createDb } from "@bite/db";
import { startWorker } from "./jobs/worker.js";

/**
 * Background worker. WORKER_DATABASE_URL must be a login in bite_system
 * (cross-tenant, BYPASSRLS), never the schema owner and never bite_app.
 */
const url = process.env.WORKER_DATABASE_URL;
if (!url) throw new Error("WORKER_DATABASE_URL is required");
const { db, client } = createDb(url, { max: 4 });
const boss = await startWorker({
	connectionString: url,
	db,
	log: (m) => console.log(m),
});
console.log("worker started");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
	process.on(sig, async () => {
		await boss.stop({ graceful: true });
		await client.end();
		process.exit(0);
	});
}
