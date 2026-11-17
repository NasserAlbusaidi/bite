/**
 * Arabic is a first-class language, not a fallback. For every message catalog
 * listed below, every language must have every English key, no empty strings,
 * the same {placeholders}, and no value pasted over from English untranslated.
 *
 * Add new apps' catalogs to CATALOGS. Each module must export
 * `messages: Record<lang, Record<key, string>>` and import only types
 * (Node runs it with type stripping).
 *
 * Run: node tools/ci/check-i18n.mts
 */
const CATALOGS = ["apps/menu/app/lib/i18n.ts"];

// Strings allowed to be identical across languages (brand names, codes).
const SAME_OK = new Set<string>(["Bite", "OMR"]);

const placeholders = (s: string) =>
	[...s.matchAll(/\{(\w+)\}/g)]
		.map((m) => m[1])
		.sort()
		.join(",");

let failures = 0;
const fail = (msg: string) => {
	failures++;
	console.error(`  ✗ ${msg}`);
};

for (const file of CATALOGS) {
	const mod = (await import(
		new URL(`../../${file}`, import.meta.url).href
	)) as {
		messages?: Record<string, Record<string, string>>;
	};
	console.log(file);
	const messages = mod.messages;
	if (!messages?.en) {
		fail(`${file} must export \`messages\` with an \`en\` catalog`);
		continue;
	}
	const en = messages.en;
	const langs = Object.keys(messages).filter((l) => l !== "en");
	if (!langs.includes("ar")) fail(`${file}: no Arabic catalog`);
	for (const [key, value] of Object.entries(en)) {
		if (!value.trim()) fail(`en.${key} is empty`);
	}
	for (const lang of langs) {
		const cat = messages[lang];
		for (const [key, value] of Object.entries(en)) {
			const t = cat[key];
			if (t === undefined) fail(`${lang}.${key} missing`);
			else if (!t.trim()) fail(`${lang}.${key} is empty`);
			else {
				if (t === value && /[A-Za-z]/.test(value) && !SAME_OK.has(value))
					fail(`${lang}.${key} is untranslated English: "${value}"`);
				if (placeholders(t) !== placeholders(value))
					fail(
						`${lang}.${key} placeholders {${placeholders(t)}} != en {${placeholders(value)}}`,
					);
			}
		}
		for (const key of Object.keys(cat)) {
			if (!(key in en))
				fail(`${lang}.${key} has no English source (stale key)`);
		}
	}
}

if (failures) {
	console.error(`\ni18n: ${failures} problem(s).`);
	process.exit(1);
}
console.log("i18n: all catalogs complete.");
