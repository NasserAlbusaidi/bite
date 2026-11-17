import { createCookie } from "react-router";

/**
 * Which group carts this browser has joined, and the participant secret for each.
 * Kept in an httpOnly cookie so page scripts never see the secret: every group
 * write goes through our server actions, which read it from here.
 */
export type Seat = { participantId: string; secret: string; exp: number };
type Seats = Record<string, Seat>;

/** Carts live 2h on the API; keep the seat a bit longer, then let it go. */
const TTL_MS = 3 * 60 * 60 * 1000;
const MAX_SEATS = 5;

const cookie = createCookie("bite_group", {
	httpOnly: true,
	sameSite: "lax",
	path: "/",
	secure: process.env.NODE_ENV === "production",
	maxAge: TTL_MS / 1000,
});

const isSeat = (v: unknown): v is Seat =>
	typeof v === "object" &&
	v !== null &&
	typeof (v as Seat).participantId === "string" &&
	typeof (v as Seat).secret === "string" &&
	Number.isSafeInteger((v as Seat).exp);

async function readAll(
	request: Request,
	now: number,
): Promise<Map<string, Seat>> {
	let raw: unknown = null;
	try {
		raw = await cookie.parse(request.headers.get("cookie"));
	} catch {
		raw = null;
	}
	const seats = new Map<string, Seat>();
	if (typeof raw !== "object" || raw === null) return seats;
	for (const [token, seat] of Object.entries(raw as Seats)) {
		if (isSeat(seat) && seat.exp > now) seats.set(token, seat);
	}
	return seats;
}

export async function readSeat(
	request: Request,
	token: string,
	now = Date.now(),
): Promise<Seat | null> {
	return (await readAll(request, now)).get(token) ?? null;
}

/** Set-Cookie value that adds this seat (newest wins, oldest dropped past the cap). */
export async function seatCookie(
	request: Request,
	token: string,
	seat: Omit<Seat, "exp">,
	now = Date.now(),
): Promise<string> {
	const seats = await readAll(request, now);
	seats.delete(token);
	seats.set(token, { ...seat, exp: now + TTL_MS });
	const kept = [...seats].slice(-MAX_SEATS);
	return cookie.serialize(Object.fromEntries(kept));
}
