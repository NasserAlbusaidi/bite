import { useToast } from "@bite/ui";
import { useEffect } from "react";
import { useLocation, useNavigation, useRevalidator } from "react-router";
import { onToastNow, takeFlash } from "../lib/flash";

/** Shows a toast an action queued with flash(), once navigation settles. */
export function FlashToasts() {
	const toast = useToast();
	const { key } = useLocation();
	const nav = useNavigation().state;
	const reval = useRevalidator().state;
	const state = nav === "idle" && reval === "idle" ? "idle" : "busy";
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-check on every settled navigation or fetcher round
	useEffect(() => {
		if (state !== "idle") return;
		const f = takeFlash();
		if (f) toast(f.message, f.tone);
	}, [key, state, toast]);
	useEffect(() => onToastNow((f) => toast(f.message, f.tone)), [toast]);
	return null;
}
