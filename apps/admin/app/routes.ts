import {
	index,
	layout,
	type RouteConfig,
	route,
} from "@react-router/dev/routes";

export default [
	route("sign-in", "routes/sign-in.tsx"),
	route("orgs", "routes/orgs.tsx"),
	route("accept-invite", "routes/accept-invite.tsx"),
	route("platform", "routes/platform.tsx", [
		index("routes/platform-orgs.tsx"),
		route("new", "routes/platform-new.tsx"),
		route("orgs/:orgId", "routes/platform-org.tsx"),
	]),
	layout("routes/shell.tsx", [
		layout("routes/shell-pages.tsx", [
			index("routes/home.tsx"),
			route("menu", "routes/menu.tsx"),
			route("menu/create", "routes/menu-create.tsx"),
			route("menu/products/:productId", "routes/product.tsx"),
			route("menu/modifiers", "routes/modifiers.tsx"),
			route("menu/modifiers/:groupId", "routes/modifier-group.tsx"),
			route("locations/:locationId/menu", "routes/location-menu.tsx"),
			route("locations/:locationId/settings", "routes/location-settings.tsx"),
			route("locations/:locationId/floor", "routes/floor-plan.tsx"),
			route("promotions", "routes/promotions.tsx"),
			route("promotions/:promotionId", "routes/promotion.tsx"),
			route("reports", "routes/reports.tsx"),
			route("orders", "routes/orders.tsx"),
			route("drawers", "routes/drawers.tsx"),
			route("guests", "routes/guests.tsx"),
			route("guests/:guestId", "routes/guest.tsx"),
			route("loyalty", "routes/loyalty.tsx"),
			route("staff", "routes/staff.tsx"),
			route("staff/:staffId", "routes/staff-member.tsx"),
			route("account", "routes/account.tsx"),
			route("setup", "routes/setup.tsx"),
			route("*", "routes/not-found.tsx"),
		]),
	]),
] satisfies RouteConfig;
