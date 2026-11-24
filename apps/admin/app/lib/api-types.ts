import type {
	AdjustPoints,
	AdminCashSession,
	AdminCategory,
	AdminCustomer,
	AdminCustomerDetail,
	AdminCustomersQuery,
	AdminDevice,
	AdminLocationSettings,
	AdminMe,
	AdminMenu,
	AdminModifierGroup,
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
	InviteStaff,
	InviteStaffResponse,
	LocationProduct,
	LoyaltyProgram,
	PutFloorRequest,
	RegisterDeviceRequest,
	RegisterDeviceResponse,
	Reorder,
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
} from "./contracts";

export class AdminApiError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
		readonly details?: unknown,
	) {
		super(code);
	}
}

export interface AdminApi {
	me(): Promise<AdminMe>;
	locations(): Promise<AdminLocationSettings[]>;
	menu(): Promise<AdminMenu>;
	createProduct(p: CreateProduct): Promise<AdminProduct>;
	updateProduct(id: string, p: UpdateProduct): Promise<AdminProduct>;
	archiveProduct(id: string): Promise<void>;
	createCategory(c: CreateCategory): Promise<AdminCategory>;
	updateCategory(id: string, c: UpdateCategory): Promise<AdminCategory>;
	/** New sort orders in one go; every id must exist or nothing changes. */
	reorderCategories(items: Reorder): Promise<void>;
	reorderProducts(items: Reorder): Promise<void>;
	/** Stores a product photo and answers with its public URL. */
	uploadImage(image: Blob): Promise<string>;
	createModifierGroup(g: CreateModifierGroup): Promise<AdminModifierGroup>;
	updateModifierGroup(
		id: string,
		g: UpdateModifierGroup,
	): Promise<AdminModifierGroup>;
	/** Option calls answer with the whole group, like the API. */
	createModifierOption(
		groupId: string,
		o: CreateModifierOption,
	): Promise<AdminModifierGroup>;
	updateModifierOption(
		groupId: string,
		optionId: string,
		o: UpdateModifierOption,
	): Promise<AdminModifierGroup>;
	locationProducts(locationId: string): Promise<LocationProduct[]>;
	setLocationProduct(
		locationId: string,
		productId: string,
		s: SetLocationProduct,
	): Promise<void>;
	promotions(): Promise<AdminPromotion[]>;
	createPromotion(p: CreatePromotion): Promise<AdminPromotion>;
	updatePromotion(id: string, p: UpdatePromotion): Promise<AdminPromotion>;
	staff(): Promise<AdminStaff[]>;
	/** The token comes back once; the UI turns it into a share link. */
	inviteStaff(s: InviteStaff): Promise<InviteStaffResponse>;
	/** New link for a pending invite; the old one stops working. */
	reissueInvite(id: string): Promise<InviteStaffResponse>;
	createPinStaff(s: CreatePinStaff): Promise<AdminStaff>;
	updateStaff(id: string, s: UpdateStaff): Promise<AdminStaff>;
	resetPin(id: string, pin: string): Promise<void>;
	deactivateStaff(id: string): Promise<void>;
	/** Undo a deactivation: roles and PIN were kept. */
	reactivateStaff(id: string): Promise<void>;
	updateLocation(id: string, l: UpdateLocation): Promise<AdminLocationSettings>;
	devices(locationId: string): Promise<AdminDevice[]>;
	/** The branch's floor plan. */
	floor(locationId: string): Promise<Floor>;
	/** Saves the whole plan; what's missing is deleted. Answers with the saved plan. */
	saveFloor(locationId: string, f: PutFloorRequest): Promise<Floor>;
	registerDevice(d: RegisterDeviceRequest): Promise<RegisterDeviceResponse>;
	revokeDevice(id: string): Promise<void>;
	salesReport(q: SalesReportQuery): Promise<SalesReport>;
	orders(
		q: Omit<AdminOrdersQuery, "limit"> & { limit?: number },
	): Promise<{ items: AdminOrderRow[]; nextCursor?: string | undefined }>;
	ordersCsv(q: Omit<AdminOrdersQuery, "cursor" | "limit">): Promise<Blob>;
	trends(q: SalesReportQuery): Promise<TrendsReport>;
	order(id: string): Promise<AdminOrderDetail>;
	cashSessions(q: SalesReportQuery): Promise<AdminCashSession[]>;
	loyalty(): Promise<LoyaltyProgram>;
	saveLoyalty(p: LoyaltyProgram): Promise<LoyaltyProgram>;
	customers(q: AdminCustomersQuery): Promise<AdminCustomer[]>;
	customer(id: string): Promise<AdminCustomerDetail>;
	adjustPoints(id: string, a: AdjustPoints): Promise<AdminCustomerDetail>;
}
