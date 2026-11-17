import {
	index,
	layout,
	type RouteConfig,
	route,
} from "@react-router/dev/routes";

export default [
	layout("routes/shell.tsx", [
		index("routes/home.tsx"),
		route("menu", "routes/menu.tsx"),
		route("menu/products/:productId", "routes/product.tsx"),
		route("locations/:locationId/menu", "routes/location-menu.tsx"),
		route("promotions", "routes/promotions.tsx"),
		route("promotions/:promotionId", "routes/promotion.tsx"),
	]),
] satisfies RouteConfig;
