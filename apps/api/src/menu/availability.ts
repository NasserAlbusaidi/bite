import { schema, type Tx } from "@bite/db";
import { eq } from "@bite/db/orm";
import { ApiError } from "../lib/errors.js";

const { products, productLocationSettings } = schema;

/** 86 / un-86 a product at one location. Idempotent. Runs inside withTenant(). */
export async function setAvailability(
	tx: Tx,
	orgId: string,
	locationId: string,
	productId: string,
	isAvailable: boolean,
): Promise<void> {
	const [p] = await tx
		.select({ id: products.id })
		.from(products)
		.where(eq(products.id, productId));
	if (!p) throw new ApiError("not_found", "no such product");
	await tx
		.insert(productLocationSettings)
		.values({ orgId, productId, locationId, isAvailable })
		.onConflictDoUpdate({
			target: [
				productLocationSettings.productId,
				productLocationSettings.locationId,
			],
			set: { isAvailable, updatedAt: new Date() },
		});
}
