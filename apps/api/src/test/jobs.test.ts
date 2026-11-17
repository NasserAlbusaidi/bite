import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	expireGroupCarts,
	expireGuestOrders,
	pruneSyncMutations,
} from "../jobs/tasks.js";
import { startWorker } from "../jobs/worker.js";
import {
	type Harness,
	json,
	ownerUrl,
	setupHarness,
	uuidv7,
} from "./harness.js";

describe.runIf(ownerUrl)("background jobs", () => {
	let h: Harness;
	beforeAll(async () => {
		h = await setupHarness();
	});
	afterAll(() => h?.close());

	const guestOrder = async (slug: string, productId: string) => {
		const res = await h.app.request(
			`/v1/public/locations/${slug}/orders`,
			json(
				{
					locationSlug: slug,
					type: "takeaway",
					lines: [
						{ id: uuidv7(), productId, quantity: 1, modifierOptionIds: [] },
					],
				},
				{ "idempotency-key": uuidv7() },
			),
		);
		const { order } = (await res.json()) as {
			order: { trackingToken: string };
		};
		const [row] =
			await h.owner`select id from orders where tracking_token = ${order.trackingToken}`;
		return row?.id as string;
	};

	it("cancels unpaid guest orders past expiry in every tenant, and nothing else", async () => {
		const aOld = await guestOrder("a-main", h.A.prod);
		const bOld = await guestOrder("b-main", h.B.prod);
		const fresh = await guestOrder("a-main", h.A.prod);
		const paidOld = await guestOrder("a-main", h.A.prod);
		await h.owner`update orders set expires_at = now() - interval '1 minute' where id in (${aOld}, ${bOld}, ${paidOld})`;
		await h.owner`update orders set payment_status = 'paid', paid_total = total where id = ${paidOld}`;

		expect(await expireGuestOrders(h.systemDb, new Date())).toBe(2);
		const rows =
			await h.owner`select id, fulfillment_status, version from orders where id in (${aOld}, ${bOld}, ${fresh}, ${paidOld})`;
		const by = Object.fromEntries(rows.map((r) => [r.id, r]));
		expect(by[aOld]).toMatchObject({
			fulfillment_status: "cancelled",
			version: 2,
		});
		expect(by[bOld]).toMatchObject({ fulfillment_status: "cancelled" });
		expect(by[fresh]).toMatchObject({ fulfillment_status: "pending" });
		expect(by[paidOld]).toMatchObject({ fulfillment_status: "pending" });
		expect(await expireGuestOrders(h.systemDb, new Date())).toBe(0);
	});

	it("expires stale group carts", async () => {
		const res = await h.app.request(
			"/v1/public/locations/a-main/group-carts",
			json({ displayName: "x" }),
		);
		const { cart } = (await res.json()) as { cart: { token: string } };
		await h.owner`update group_carts set expires_at = now() - interval '1 minute' where token = ${cart.token}`;
		expect(await expireGroupCarts(h.systemDb, new Date())).toBe(1);
		const [row] =
			await h.owner`select status from group_carts where token = ${cart.token}`;
		expect(row?.status).toBe("expired");
	});

	it("prunes old idempotency records", async () => {
		await h.owner`insert into sync_mutations (id, org_id, device_id, member_id, kind, entity_id, fingerprint, result, created_at)
			values (${uuidv7()}, ${h.A.org}, ${h.A.device}, ${h.A.cashier}, 'cash.open', ${uuidv7()}, 'x', '{}', now() - interval '40 days')`;
		expect(await pruneSyncMutations(h.systemDb, new Date())).toBe(1);
	});

	it("the app role cannot run these (RLS + grants)", async () => {
		// bite_app sees nothing without a tenant, so the same statement is a no-op.
		const res = await h.app.request(
			"/v1/public/locations/a-main/group-carts",
			json({ displayName: "x" }),
		);
		const { cart } = (await res.json()) as { cart: { token: string } };
		await h.owner`update group_carts set expires_at = now() - interval '1 minute' where token = ${cart.token}`;
		expect(await expireGroupCarts(h.deps.db, new Date())).toBe(0);
		await expect(
			pruneSyncMutations(h.deps.db, new Date(Date.now() + 1e12)),
		).rejects.toThrow();
	});

	it("runs the queues through pg-boss as bite_system", async () => {
		const id = await guestOrder("a-main", h.A.prod);
		await h.owner`update orders set expires_at = now() - interval '1 minute' where id = ${id}`;
		const boss = await startWorker({
			connectionString: h.systemUrl,
			db: h.systemDb,
		});
		try {
			await boss.send("expire-guest-orders", {});
			const start = Date.now();
			let status = "pending";
			while (status === "pending" && Date.now() - start < 10_000) {
				await new Promise((r) => setTimeout(r, 200));
				const [row] =
					await h.owner`select fulfillment_status from orders where id = ${id}`;
				status = row?.fulfillment_status as string;
			}
			expect(status).toBe("cancelled");
		} finally {
			await boss.stop({ graceful: false });
		}
	});
});
