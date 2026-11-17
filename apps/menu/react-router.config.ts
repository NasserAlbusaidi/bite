import type { Config } from "@react-router/dev/config";

export default {
	ssr: true,
	// Ship the whole (small) route manifest with the first page. With lazy
	// discovery, the first poll or tap after a wifi blip has to fetch
	// /__manifest, and if that fails the page is replaced by an error.
	routeDiscovery: { mode: "initial" },
} satisfies Config;
