/** Back-office contracts come from the API (packages/contracts/src/admin.ts). */
export {
	AdminCategory,
	AdminLocationSettings,
	AdminMe,
	AdminModifierGroup,
	AdminProduct,
	CreateCategory,
	CreateProduct,
	LocationProduct,
	Page,
	SetLocationProduct,
	UpdateCategory,
	UpdateProduct,
} from "@bite/contracts";

import type {
	AdminCategory,
	AdminModifierGroup,
	AdminProduct,
} from "@bite/contracts";

/** The org menu as one value: the API serves the three lists separately. */
export type AdminMenu = {
	categories: AdminCategory[];
	products: AdminProduct[];
	modifierGroups: AdminModifierGroup[];
};
