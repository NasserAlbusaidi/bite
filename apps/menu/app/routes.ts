import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
	index("routes/index.tsx"),
	route(":slug", "routes/lang-redirect.tsx"),
	// Shared group links carry no language, so each guest gets their own.
	route(":slug/group/:token", "routes/lang-redirect.tsx", {
		id: "group-lang-redirect",
	}),
	route(":lang/:slug", "routes/menu.tsx"),
	route(":lang/:slug/checkout", "routes/checkout.tsx"),
	route(":lang/:slug/orders/:token", "routes/order.tsx"),
	route(":lang/:slug/group", "routes/group-new.tsx"),
	route(":lang/:slug/group/:token", "routes/group.tsx"),
	route(":lang/:slug/group/:token/state", "routes/group-state.tsx"),
	route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
