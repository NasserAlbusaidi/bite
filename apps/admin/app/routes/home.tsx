import { redirect } from "react-router";

export function clientLoader() {
	return redirect("/menu");
}

export default function Home() {
	return null;
}
