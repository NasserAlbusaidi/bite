/**
 * Guest menu bundle budget. Guests open the menu on a phone over mobile data
 * after scanning a QR code; every KB is load time. Budgets are gzip sizes of
 * the client build. Raise them deliberately in a PR that says why.
 *
 *   node tools/ci/check-bundle.mts   (after `pnpm build`)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGETS = [
	{
		dir: "apps/menu/build/client",
		totalJsKb: 150,
		largestJsKb: 90,
		totalCssKb: 15,
	},
];

const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		return statSync(p).isDirectory() ? walk(p) : [p];
	});
const gz = (p: string) => gzipSync(readFileSync(p), { level: 9 }).length / 1024;

let failed = false;
for (const b of BUDGETS) {
	let files: string[];
	try {
		files = walk(b.dir);
	} catch {
		console.error(`✗ ${b.dir} not found. Run pnpm build first.`);
		process.exit(1);
	}
	const js = files
		.filter((f) => f.endsWith(".js"))
		.map((f) => [f, gz(f)] as const);
	const css = files.filter((f) => f.endsWith(".css")).map((f) => gz(f));
	const totalJs = js.reduce((s, [, k]) => s + k, 0);
	const [bigFile, bigKb] = js.reduce((a, c) => (c[1] > a[1] ? c : a), [
		"",
		0,
	] as const);
	const totalCss = css.reduce((s, k) => s + k, 0);
	const rows = [
		["total JS", totalJs, b.totalJsKb],
		[`largest JS (${bigFile.split("/").pop()})`, bigKb, b.largestJsKb],
		["total CSS", totalCss, b.totalCssKb],
	] as const;
	console.log(b.dir);
	for (const [name, kb, max] of rows) {
		const ok = kb <= max;
		if (!ok) failed = true;
		console.log(
			`  ${ok ? "✓" : "✗"} ${name}: ${kb.toFixed(1)} KB gz (budget ${max} KB)`,
		);
	}
}
if (failed) {
	console.error("\nBundle budget exceeded.");
	process.exit(1);
}
