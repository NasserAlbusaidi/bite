import { translator } from "../lib/i18n";

export const meta = () => [{ title: "Bite" }];

/** Bare domain: there is no menu without a location slug from the QR code. */
export default function Index() {
	const en = translator("en");
	const ar = translator("ar");
	return (
		<main className="page page--center">
			<h1>{en("not_found_body")}</h1>
			<p lang="ar" dir="rtl">
				{ar("not_found_body")}
			</p>
		</main>
	);
}
