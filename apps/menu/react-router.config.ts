import type { Config } from "@react-router/dev/config";

/**
 * Behind a TLS proxy (Cloudflare, a load balancer) the server sees http while
 * the browser's Origin is https, so React Router's CSRF check rejects every
 * form action (checkout, group cart) with a bare 400. List the public menu
 * host(s) here at build time, comma separated; wildcards like
 * "*.trycloudflare.com" work. Unset = same-origin only.
 */
const actionHosts = (process.env.BITE_MENU_ACTION_HOSTS ?? "")
	.split(",")
	.map((h) => h.trim())
	.filter(Boolean);

export default {
	ssr: true,
	// Ship the whole (small) route manifest with the first page. With lazy
	// discovery, the first poll or tap after a wifi blip has to fetch
	// /__manifest, and if that fails the page is replaced by an error.
	routeDiscovery: { mode: "initial" },
	...(actionHosts.length ? { allowedActionOrigins: actionHosts } : {}),
} satisfies Config;
