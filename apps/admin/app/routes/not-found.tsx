import { data } from "react-router";

/** Any address the back office doesn't have. The shell's boundary draws it. */
export function clientLoader() {
	throw data(null, { status: 404 });
}

export default function NotFound() {
	return null;
}
