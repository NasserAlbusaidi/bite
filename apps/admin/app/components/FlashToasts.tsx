import { useToast } from "@bite/ui";
import { useEffect } from "react";
import { useLocation, useNavigation } from "react-router";
import { takeFlash } from "../lib/flash";

/** Shows a toast an action queued with flash(), once navigation settles. */
export function FlashToasts() {
	const toast = useToast();
	const { key } = useLocation();
	const { state } = useNavigation();
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-check on every settled navigation or fetcher round
	useEffect(() => {
		if (state !== "idle") return;
		const f = takeFlash();
		if (f) toast(f.message, f.tone);
	}, [key, state, toast]);
	return null;
}
