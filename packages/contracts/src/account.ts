import { z } from "zod";
import { Id, OrgRole } from "./common.js";

/**
 * Back-office login, before an org is chosen. Sign-in/up/out live under
 * /v1/auth/* (Better Auth, email + password, session cookie). Everything
 * under /v1/admin acts on one org: send ORG_HEADER when the login belongs to
 * more than one org (otherwise the only org is used).
 */
export const ORG_HEADER = "x-org-id";

const Slug = z
	.string()
	.min(3)
	.max(48)
	.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, digits and dashes");

/** GET /v1/account/orgs */
export const AccountOrg = z.object({
	id: Id,
	name: z.string(),
	slug: z.string(),
	orgRole: OrgRole,
});
export const AccountOrgs = z.object({ items: z.array(AccountOrg) });

/** POST /v1/account/orgs: onboarding. The caller becomes the owner. */
export const CreateOrg = z.object({
	orgName: z.string().trim().min(1).max(80),
	orgSlug: Slug,
	locationName: z.string().trim().min(1).max(80),
	/** Guest menu URL segment, globally unique. */
	locationSlug: Slug,
	timezone: z.string().min(1).max(64).default("Asia/Muscat"),
	/** Defaults to the login's name. */
	displayName: z.string().trim().min(1).max(80).optional(),
});
export const CreatedOrg = z.object({ orgId: Id, locationId: Id, memberId: Id });

export type AccountOrg = z.infer<typeof AccountOrg>;
export type AccountOrgs = z.infer<typeof AccountOrgs>;
export type CreateOrg = z.infer<typeof CreateOrg>;
export type CreatedOrg = z.infer<typeof CreatedOrg>;
