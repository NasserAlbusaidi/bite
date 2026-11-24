/** Back-office contracts come from the API (packages/contracts/src/admin.ts). */
export {
	AdminCashSession,
	AdminCategory,
	AdminDevice,
	AdminLocationSettings,
	AdminMe,
	AdminModifierGroup,
	AdminModifierOption,
	AdminOrderDetail,
	AdminOrderRow,
	AdminOrdersQuery,
	AdminProduct,
	AdminPromotion,
	AdminStaff,
	CreateCategory,
	CreateModifierGroup,
	CreateModifierOption,
	CreatePinStaff,
	CreateProduct,
	CreatePromotion,
	Floor,
	FloorArea,
	FloorTable,
	FloorTableInput,
	InviteStaff,
	InviteStaffResponse,
	LocationProduct,
	Page,
	PutFloorRequest,
	RegisterDeviceRequest,
	RegisterDeviceResponse,
	Reorder,
	ResetPin,
	SalesReport,
	SalesReportQuery,
	SetLocationProduct,
	TrendsReport,
	UpdateCategory,
	UpdateLocation,
	UpdateModifierGroup,
	UpdateModifierOption,
	UpdateProduct,
	UpdatePromotion,
	UpdateStaff,
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
