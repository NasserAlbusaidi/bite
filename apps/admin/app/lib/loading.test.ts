import { describe, expect, it } from "vitest";
import {
	BITE_AFTER_MS,
	holdFor,
	isSpeedCritical,
	loadingPhase,
	MIN_VISIBLE_MS,
	navigationKind,
	nextPhaseAt,
	SLOW_AFTER_MS,
	THREAD_AFTER_MS,
} from "./loading";

describe("loadingPhase", () => {
	it("shows nothing for quick loads", () => {
		expect(loadingPhase(0, "page")).toBe("idle");
		expect(loadingPhase(THREAD_AFTER_MS - 1, "page")).toBe("idle");
		expect(loadingPhase(THREAD_AFTER_MS - 1, "save")).toBe("idle");
	});
	it("page loads go thread, then bite, then slow", () => {
		expect(loadingPhase(THREAD_AFTER_MS, "page")).toBe("thread");
		expect(loadingPhase(BITE_AFTER_MS - 1, "page")).toBe("thread");
		expect(loadingPhase(BITE_AFTER_MS, "page")).toBe("bite");
		expect(loadingPhase(SLOW_AFTER_MS - 1, "page")).toBe("bite");
		expect(loadingPhase(SLOW_AFTER_MS, "page")).toBe("slow");
	});
	it("saves only ever get the thread (no Retry that could send twice)", () => {
		expect(loadingPhase(THREAD_AFTER_MS, "save")).toBe("thread");
		expect(loadingPhase(BITE_AFTER_MS, "save")).toBe("thread");
		expect(loadingPhase(60_000, "save")).toBe("thread");
	});
});

describe("speed-critical pages", () => {
	it("are live orders and cash drawers", () => {
		expect(isSpeedCritical("/orders")).toBe(true);
		expect(isSpeedCritical("/drawers")).toBe(true);
		expect(isSpeedCritical("/orders/123")).toBe(true);
		expect(isSpeedCritical("/")).toBe(false);
		expect(isSpeedCritical("/reports")).toBe(false);
		expect(isSpeedCritical("/ordersx")).toBe(false);
	});
	it("only ever get the lime line, then the Retry bar", () => {
		expect(loadingPhase(THREAD_AFTER_MS - 1, "fast")).toBe("idle");
		expect(loadingPhase(THREAD_AFTER_MS, "fast")).toBe("thread");
		expect(loadingPhase(BITE_AFTER_MS, "fast")).toBe("thread");
		expect(loadingPhase(SLOW_AFTER_MS - 1, "fast")).toBe("thread");
		expect(loadingPhase(SLOW_AFTER_MS, "fast")).toBe("slow");
		expect(nextPhaseAt(THREAD_AFTER_MS, "fast")).toBe(SLOW_AFTER_MS);
	});
});

describe("nextPhaseAt", () => {
	it("walks the page steps", () => {
		expect(nextPhaseAt(0, "page")).toBe(THREAD_AFTER_MS);
		expect(nextPhaseAt(THREAD_AFTER_MS, "page")).toBe(BITE_AFTER_MS);
		expect(nextPhaseAt(BITE_AFTER_MS, "page")).toBe(SLOW_AFTER_MS);
		expect(nextPhaseAt(SLOW_AFTER_MS, "page")).toBeNull();
	});
	it("stops after the thread for saves", () => {
		expect(nextPhaseAt(0, "save")).toBe(THREAD_AFTER_MS);
		expect(nextPhaseAt(THREAD_AFTER_MS, "save")).toBeNull();
	});
});

describe("holdFor", () => {
	it("keeps a visible treatment up for at least the minimum", () => {
		expect(holdFor(null, 1000)).toBe(0);
		expect(holdFor(1000, 1000)).toBe(MIN_VISIBLE_MS);
		expect(holdFor(1000, 1000 + MIN_VISIBLE_MS - 100)).toBe(100);
		expect(holdFor(1000, 1000 + MIN_VISIBLE_MS + 5)).toBe(0);
	});
});

describe("navigationKind", () => {
	it("is silent when idle", () => {
		expect(navigationKind({ state: "idle" })).toBeNull();
	});
	it("treats links and GET forms (filters, search) as page loads", () => {
		expect(navigationKind({ state: "loading" })).toBe("page");
		expect(navigationKind({ state: "loading", formMethod: "GET" })).toBe(
			"page",
		);
		expect(navigationKind({ state: "submitting", formMethod: "get" })).toBe(
			"page",
		);
	});
	it("treats other methods as saves, including the reload after one", () => {
		expect(navigationKind({ state: "submitting", formMethod: "POST" })).toBe(
			"save",
		);
		expect(navigationKind({ state: "loading", formMethod: "POST" })).toBe(
			"save",
		);
		expect(navigationKind({ state: "submitting", formMethod: "DELETE" })).toBe(
			"save",
		);
	});
	it("a save that sends you to another page becomes a page load", () => {
		const signIn = {
			state: "loading" as const,
			formMethod: "POST",
			location: { pathname: "/" },
		};
		expect(navigationKind(signIn, "/sign-in")).toBe("page");
		// still on the same page: the reload after a save stays a save
		expect(navigationKind(signIn, "/")).toBe("save");
		// while the action itself runs it is a save, wherever it ends up
		expect(navigationKind({ ...signIn, state: "submitting" }, "/sign-in")).toBe(
			"save",
		);
	});
});
