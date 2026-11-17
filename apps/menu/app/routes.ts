import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
	index("routes/index.tsx"),
	route(":slug", "routes/lang-redirect.tsx"),
	route(":lang/:slug", "routes/menu.tsx"),
	route(":lang/:slug/checkout", "routes/checkout.tsx"),
	route(":lang/:slug/orders/:token", "routes/order.tsx"),
	route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
