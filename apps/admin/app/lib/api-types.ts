import type {
	AdminCategory,
	AdminLocationSettings,
	AdminMe,
	AdminMenu,
	AdminProduct,
	AdminPromotion,
	AdminStaff,
	CreateCategory,
	CreatePinStaff,
	CreateProduct,
	CreatePromotion,
	InviteStaff,
	LocationProduct,
	SetLocationProduct,
	UpdateCategory,
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
	inviteStaff(s: InviteStaff): Promise<AdminStaff>;
	createPinStaff(s: CreatePinStaff): Promise<AdminStaff>;
	updateStaff(id: string, s: UpdateStaff): Promise<AdminStaff>;
	resetPin(id: string, pin: string): Promise<void>;
	deactivateStaff(id: string): Promise<void>;
}
