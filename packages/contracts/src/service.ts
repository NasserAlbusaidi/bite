import { z } from "zod";
import { Id } from "./common.js";
import { TableLabel } from "./orders.js";

/**
 * Guest service calls from the QR menu: "call a waiter" or "bring the bill".
 * Short-lived and table-scoped. The till shows them until staff mark them done.
 */
export const ServiceRequestKind = z.enum(["waiter", "bill"]);
export type ServiceRequestKind = z.infer<typeof ServiceRequestKind>;

/** POST /v1/public/locations/:slug/service-requests */
export const CreateServiceRequest = z.object({
	kind: ServiceRequestKind,
	tableLabel: TableLabel,
});
export type CreateServiceRequest = z.infer<typeof CreateServiceRequest>;

export const ServiceRequest = z.object({
	id: Id,
	kind: ServiceRequestKind,
	tableLabel: z.string(),
	/** ISO time of the first call; a repeat call keeps it and bumps `calls`. */
	createdAt: z.string(),
	calls: z.int().min(1),
});
export type ServiceRequest = z.infer<typeof ServiceRequest>;

/** Response of the guest POST and of GET /v1/device/service-requests. */
export const ServiceRequestResponse = z.object({ request: ServiceRequest });
export type ServiceRequestResponse = z.infer<typeof ServiceRequestResponse>;

export const ServiceRequestList = z.object({
	requests: z.array(ServiceRequest),
});
export type ServiceRequestList = z.infer<typeof ServiceRequestList>;
