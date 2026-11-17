import type { AdminApi } from "./api-types";

/** A location this member manages, with what the UI needs to show money there. */
export type Place = {
	id: string;
	name: string;
	slug: string;
	currencyCode: string;
	/** Minor-unit digits: OMR 3, AED 2. */
	decimals: number;
};

/** ISO 4217 minor digits from the platform's currency data. */
export function currencyDecimals(code: string): number {
	try {
		return (
			new Intl.NumberFormat("en", {
				style: "currency",
				currency: code,
			}).resolvedOptions().maximumFractionDigits ?? 2
		);
	} catch {
		return 2;
	}
}

/** The locations in /me, joined with their settings for currency. */
export async function loadPlaces(api: AdminApi): Promise<Place[]> {
	const [me, settings] = await Promise.all([api.me(), api.locations()]);
	const byId = new Map(settings.map((s) => [s.id, s]));
	return me.locations.flatMap(({ location }) => {
		const s = byId.get(location.id);
		if (!s) return [];
		return [
			{
				id: location.id,
				name: location.name,
				slug: location.slug,
				currencyCode: s.currencyCode,
				decimals: currencyDecimals(s.currencyCode),
			},
		];
	});
}
