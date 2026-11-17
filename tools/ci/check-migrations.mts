/**
 * Drizzle migrations are append-only once merged: editing or deleting a
 * migration that already ran in some database forks the schema history.
 * Compares the PR head against the merge base.
 *
 *   node tools/ci/check-migrations.mts <base-ref>
 *
 * Rules, under packages/db/migrations/:
 * - existing .sql files and meta/*_snapshot.json files: never modified,
 *   renamed or deleted (only added)
 * - meta/_journal.json: existing entries unchanged; new entries appended
 *
 * Schema drift (schema changed without a generated migration) is checked
 * separately by running drizzle-kit generate and diffing.
 */
import { execFileSync } from "node:child_process";

const base = process.argv[2];
if (!base) {
	console.error("usage: check-migrations.mts <base-ref>");
	process.exit(2);
}
const DIR = "packages/db/migrations";
const git = (...args: string[]) =>
	execFileSync("git", args, { encoding: "utf8" });

const mergeBase = git("merge-base", base, "HEAD").trim();
const changes = git("diff", "--name-status", "-M", mergeBase, "HEAD", "--", DIR)
	.split("\n")
	.filter(Boolean)
	.map((l) => l.split("\t"));

let failures = 0;
for (const [status, path, renamedTo] of changes) {
	if (path === `${DIR}/meta/_journal.json` && status === "M") continue;
	if (status === "A") continue;
	failures++;
	console.error(
		`✗ ${status} ${path}${renamedTo ? ` -> ${renamedTo}` : ""}: merged migrations are immutable. Add a new migration instead.`,
	);
}

type Journal = { entries: { idx: number; tag: string; when: number }[] };
const readJournal = (ref: string): Journal | null => {
	try {
		return JSON.parse(git("show", `${ref}:${DIR}/meta/_journal.json`));
	} catch {
		return null;
	}
};
const before = readJournal(mergeBase);
const after = readJournal("HEAD");
if (before && after) {
	before.entries.forEach((e, i) => {
		const now = after.entries[i];
		if (!now || now.tag !== e.tag || now.idx !== e.idx || now.when !== e.when) {
			failures++;
			console.error(
				`✗ _journal.json entry ${e.idx} (${e.tag}) was changed or removed. Only append.`,
			);
		}
	});
}

if (failures) process.exit(1);
console.log(
	`migrations: ${changes.length} change(s) vs ${base}, all append-only.`,
);
