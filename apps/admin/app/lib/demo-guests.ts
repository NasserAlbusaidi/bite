/**
 * Made-up regulars and a loyalty program for the demo back office.
 * Deterministic, in memory (the program is also kept in localStorage).
 */
import {
	AdjustPoints,
	type AdminCustomer,
	type AdminCustomerDetail,
	type AdminCustomersQuery,
	LoyaltyProgram,
} from "./contracts";

const PROGRAM_KEY = "bite.demo.loyalty";

const DEFAULT_PROGRAM: LoyaltyProgram = {
	enabled: true,
	pointsPerRial: 10,
	rewards: [
		{
			id: "coffee",
			name: { en: "Free coffee", ar: "قهوة مجانية" },
			points: 150,
			value: 1600,
		},
		{
			id: "dessert",
			name: { en: "Free dessert", ar: "حلى مجاني" },
			points: 300,
			value: 2500,
		},
		{
			id: "five-off",
			name: { en: "5 OMR off", ar: "خصم ٥ ريال" },
			points: 600,
			value: 5000,
		},
	],
};

const PEOPLE: [string, string, number][] = [
	["Sara Al Balushi", "91234567", 34],
	["Ahmed Al Harthy", "92345678", 29],
	["Fatma Al Rawahi", "93456789", 24],
	["Yousuf Al Hinai", "94567890", 21],
	["Maha Al Lawati", "95678901", 18],
	["Omar Al Busaidi", "96789012", 16],
	["Noor Al Kindi", "97890123", 14],
	["Hilal Al Maskari", "98901234", 11],
	["Aisha Al Zadjali", "99012345", 9],
	["Salim Al Abri", "91122334", 8],
	["Laila Al Riyami", "92233445", 7],
	["James Carter", "93344556", 6],
	["Priya Nair", "94455667", 5],
	["Badr Al Shukaili", "95566778", 4],
	["Reem Al Siyabi", "96677889", 3],
	["Talal Al Farsi", "97788990", 2],
	["Muna Al Habsi", "98899001", 2],
	["Elena Petrova", "91357924", 1],
];
const FAVES = [
	{ en: "Karak chai", ar: "شاي كرك" },
	{ en: "Flat white", ar: "فلات وايت" },
	{ en: "Saffron latte", ar: "لاتيه بالزعفران" },
	{ en: "Date cake", ar: "كيكة التمر" },
	{ en: "Halloumi toast", ar: "توست حلوم" },
	{ en: "Shakshuka", ar: "شكشوكة" },
];
const BRANCHES = ["Azaiba", "Al Mouj"];

const id = (n: number) =>
	`0193a1b2-0000-7000-9000-${n.toString(16).padStart(12, "0")}`;
const DAY = 86_400_000;

type Guest = AdminCustomerDetail;

function build(): Guest[] {
	const now = Date.now();
	let seq = 1;
	return PEOPLE.map(([name, local, visits], i) => {
		const orders: Guest["orders"] = [];
		const ledger: Guest["ledger"] = [];
		let spent = 0;
		let points = 0;
		for (let v = 0; v < Math.min(visits, 20); v++) {
			const at =
				now - Math.floor(((v * 47 + i * 13) % 600) / 10) * DAY - v * 3_600_000;
			const total = 1800 + ((i * 7919 + v * 104_729) % 5200);
			const ticket = `A-${String(100 + ((i * 31 + v * 17) % 800)).padStart(3, "0")}`;
			const orderId = id(10_000 + seq++);
			orders.push({
				id: orderId,
				ticketNumber: ticket,
				businessDate: new Date(at).toISOString().slice(0, 10),
				locationName: BRANCHES[(i + v) % 3 === 0 ? 1 : 0] ?? "Azaiba",
				total,
				paymentStatus: "paid",
			});
			const earned = Math.floor((total * 10) / 1000);
			points += earned;
			spent += total;
			ledger.push({
				id: id(50_000 + seq),
				kind: "earn",
				points: earned,
				ticketNumber: ticket,
				rewardId: null,
				reason: null,
				createdAt: new Date(at).toISOString(),
			});
		}
		// Older visits beyond the 20 shown, so the totals look lived-in.
		for (let v = 20; v < visits; v++) {
			const total = 2500 + ((i * 31 + v * 997) % 3000);
			spent += total;
			points += Math.floor((total * 10) / 1000);
		}
		if (i % 4 === 0 && points >= 150) {
			points -= 150;
			ledger.unshift({
				id: id(90_000 + i),
				kind: "redeem",
				points: -150,
				ticketNumber: orders[0]?.ticketNumber ?? null,
				rewardId: "coffee",
				reason: null,
				createdAt: orders[0]?.businessDate
					? new Date(now - 2 * DAY).toISOString()
					: new Date(now).toISOString(),
			});
		}
		orders.sort((a, b) => b.businessDate.localeCompare(a.businessDate));
		ledger.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		const last = orders[0]?.businessDate;
		return {
			id: id(i + 1),
			name,
			phone: `+968${local}`,
			points,
			visitCount: visits,
			totalSpent: spent,
			lastVisitAt: last ? new Date(`${last}T09:30:00Z`).toISOString() : null,
			createdAt: new Date(now - (60 + i * 3) * DAY).toISOString(),
			favorites: [0, 1, 2].map((k) => ({
				name: FAVES[(i + k * 2) % FAVES.length] ?? { en: "Coffee" },
				count: Math.max(1, Math.floor(visits / (k + 2))),
			})),
			orders,
			ledger: ledger.slice(0, 30),
		};
	});
}

let guests: Guest[] | undefined;
const all = () => {
	guests ??= build();
	return guests;
};

const summary = (g: Guest): AdminCustomer => ({
	id: g.id,
	name: g.name,
	phone: g.phone,
	points: g.points,
	visitCount: g.visitCount,
	totalSpent: g.totalSpent,
	lastVisitAt: g.lastVisitAt,
	createdAt: g.createdAt,
});

export function demoCustomers(q: AdminCustomersQuery): AdminCustomer[] {
	const term = q.q?.trim().toLowerCase() ?? "";
	const digits = term.replace(/\D/g, "");
	const hit = (g: Guest) =>
		!term ||
		(g.name ?? "").toLowerCase().includes(term) ||
		(digits.length >= 3 && g.phone.includes(digits));
	const by: Record<string, (a: Guest, b: Guest) => number> = {
		recent: (a, b) => (b.lastVisitAt ?? "").localeCompare(a.lastVisitAt ?? ""),
		visits: (a, b) => b.visitCount - a.visitCount,
		spent: (a, b) => b.totalSpent - a.totalSpent,
		points: (a, b) => b.points - a.points,
	};
	return all()
		.filter(hit)
		.sort(by[q.sort ?? "recent"])
		.slice(0, q.limit ?? 100)
		.map(summary);
}

export function demoCustomer(cid: string): Guest | undefined {
	const g = all().find((x) => x.id === cid);
	return g ? structuredClone(g) : undefined;
}

export function demoAdjust(
	cid: string,
	input: unknown,
): Guest | "invalid" | undefined {
	const a = AdjustPoints.safeParse(input);
	if (!a.success) return "invalid";
	const g = all().find((x) => x.id === cid);
	if (!g) return undefined;
	if (g.points + a.data.points < 0) return "invalid";
	g.points += a.data.points;
	g.ledger.unshift({
		id: crypto.randomUUID(),
		kind: "adjust",
		points: a.data.points,
		ticketNumber: null,
		rewardId: null,
		reason: a.data.reason,
		createdAt: new Date().toISOString(),
	});
	return structuredClone(g);
}

export function demoProgram(): LoyaltyProgram {
	try {
		const raw = window.localStorage.getItem(PROGRAM_KEY);
		if (raw) {
			const p = LoyaltyProgram.safeParse(JSON.parse(raw));
			if (p.success) return p.data;
		}
	} catch {
		/* private mode: fall through */
	}
	return structuredClone(DEFAULT_PROGRAM);
}

export function demoSaveProgram(input: unknown): LoyaltyProgram | null {
	const p = LoyaltyProgram.safeParse(input);
	if (!p.success) return null;
	try {
		window.localStorage.setItem(PROGRAM_KEY, JSON.stringify(p.data));
	} catch {
		/* not saved, still returned */
	}
	return p.data;
}
