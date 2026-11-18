import { Outlet, useRouteError } from "react-router";
import { ErrorPanel } from "../components/ErrorPanel";
import { useShell } from "../lib/use-shell";

/**
 * Every page inside the shell. A page that fails, or an address that does not
 * exist, shows its error here, with the navigation still around it.
 */
export default function ShellPages() {
	return <Outlet />;
}

export function ErrorBoundary() {
	const { t } = useShell();
	return <ErrorPanel error={useRouteError()} t={t} />;
}
