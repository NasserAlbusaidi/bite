import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { covers, crumbs } from "../lib/bite-loader";
import { translator } from "../lib/i18n";
import { BiteLoader } from "./BiteLoader";
import { LoadingLayer, type LoadingState } from "./RouteLoading";

const t = translator("en");
const state = (s: Partial<LoadingState>): LoadingState => ({
	phase: "idle",
	finishing: false,
	kind: "page",
	target: "/orders?from=2026-11-01",
	...s,
});
const html = (s: Partial<LoadingState>, lang: "en" | "ar" = "en") =>
	renderToStaticMarkup(
		<LoadingLayer
			state={state(s)}
			scope="shell"
			lang={lang}
			t={translator(lang)}
		/>,
	);

describe("LoadingLayer", () => {
	it("draws nothing while idle", () => {
		expect(html({ phase: "idle" })).toBe("");
	});
	it("shows only the lime thread at first", () => {
		const out = html({ phase: "thread" });
		expect(out).toContain('class="route-thread"');
		expect(out).not.toContain("bite-loader");
	});
	it("adds the Bite logo for longer page loads", () => {
		const out = html({ phase: "bite" });
		expect(out).toContain("route-thread");
		expect(out).toContain("bite-loader");
		expect(out).toContain('role="status"');
		expect(out).toContain(t("loading"));
		expect(out).not.toContain(t("try_again"));
	});
	it("says it is slow and offers Retry after 8 s", () => {
		const out = html({ phase: "slow" });
		expect(out).toContain(t("loading_slow"));
		expect(out).toContain(t("try_again"));
	});
	it("runs the thread out and drops the logo when the load ends", () => {
		const out = html({ phase: "bite", finishing: true });
		expect(out).toContain("data-done");
		expect(out).not.toContain("bite-loader");
	});
	it("never covers speed-critical pages with the logo", () => {
		const out = html({ phase: "thread", kind: "fast" });
		expect(out).toContain("route-thread");
		expect(out).not.toContain("bite-loader");
		const slow = html({ phase: "slow", kind: "fast" });
		expect(slow).not.toContain("bite-loader");
		expect(slow).toContain("route-slow");
		expect(slow).toContain(t("try_again"));
	});
	it("uses the Arabic lettering and copy in Arabic", () => {
		const out = html({ phase: "slow" }, "ar");
		expect(out).toContain('data-script="arabic"');
		expect(out).toContain(translator("ar")("loading_slow"));
	});
});

describe("BiteLoader", () => {
	it("draws the logo, every bite and every crumb", () => {
		const out = renderToStaticMarkup(<BiteLoader label="Loading…" />);
		expect(out).toContain("bite-loader__logo");
		expect(out.match(/bite-loader__bite /g)).toHaveLength(
			covers("latin").length,
		);
		expect(out.match(/bite-loader__crumb /g)).toHaveLength(
			crumbs("latin").length,
		);
		expect(out).toContain("@keyframes bl-lac0");
		expect(out).toContain('aria-hidden="true"');
	});
});
