import type {
	AdminCategory,
	AdminLocationSettings,
	AdminMe,
	AdminMenu,
	AdminProduct,
	AdminPromotion,
	CreateCategory,
	CreateProduct,
	CreatePromotion,
	LocationProduct,
	SetLocationProduct,
	UpdateCategory,
	UpdateProduct,
	UpdatePromotion,
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
}
