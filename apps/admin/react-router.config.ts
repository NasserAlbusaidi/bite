import type { Config } from "@react-router/dev/config";

/** SPA: the back office is behind a login, so there is nothing to server-render. */
export default {
	ssr: false,
} satisfies Config;
