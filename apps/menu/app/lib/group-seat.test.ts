import { describe, expect, it } from "vitest";
import { readSeat, seatCookie } from "./group-seat.server";

const withCookie = (setCookie?: string) =>
	new Request("http://x/", {
		headers: setCookie ? { cookie: setCookie.split(";")[0] ?? "" } : {},
	});

describe("group seat cookie", () => {
	it("is httpOnly and round-trips the seat for its cart only", async () => {
		const set = await seatCookie(withCookie(), "tok-a", {
			participantId: "p1",
			secret: "s1",
		});
		expect(set).toMatch(/HttpOnly/i);
		expect(set).toMatch(/SameSite=Lax/i);
		const req = withCookie(set);
		expect(await readSeat(req, "tok-a")).toMatchObject({
			participantId: "p1",
			secret: "s1",
		});
		expect(await readSeat(req, "tok-b")).toBeNull();
	});

	it("keeps earlier seats, drops expired ones and caps the count", async () => {
		let set = await seatCookie(
			withCookie(),
			"t0",
			{ participantId: "p", secret: "s" },
			0,
		);
		const later = 4 * 60 * 60 * 1000;
		for (let i = 1; i <= 6; i++) {
			set = await seatCookie(
				withCookie(set),
				`t${i}`,
				{ participantId: "p", secret: "s" },
				later,
			);
		}
		const req = withCookie(set);
		expect(await readSeat(req, "t0", later)).toBeNull();
		expect(await readSeat(req, "t1", later)).toBeNull();
		expect(await readSeat(req, "t6", later)).not.toBeNull();
		expect(await readSeat(req, "t2", later)).not.toBeNull();
	});

	it("ignores a garbage cookie", async () => {
		const req = new Request("http://x/", {
			headers: { cookie: "bite_group=%%%nope" },
		});
		expect(await readSeat(req, "t")).toBeNull();
	});
});
