/** Regenerates src/tokens.css from src/tokens.ts. Run: pnpm --filter @bite/ui tokens */
import { writeFileSync } from "node:fs";
import { toCss } from "../src/tokens.ts";

const out = new URL("../src/tokens.css", import.meta.url);
writeFileSync(out, toCss());
console.log(`wrote ${out.pathname}`);
