import { useRouteLoaderData } from "react-router";
import type { AdminMe } from "./contracts";
import { type Lang, type T, translator } from "./i18n";
import type { Place } from "./places";

type ShellData = {
	me: AdminMe;
	places: Place[];
	locationId: string | undefined;
	demo: boolean;
	lang: Lang;
};

/** Session, locations, language and translator from the shell layout. */
export function useShell(): ShellData & { t: T; place: Place | undefined } {
	const data = useRouteLoaderData("routes/shell") as ShellData | undefined;
	if (!data) throw new Error("useShell outside the shell layout");
	return {
		...data,
		t: translator(data.lang),
		place: data.places.find((p) => p.id === data.locationId),
	};
}
