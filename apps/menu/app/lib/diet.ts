import type { DietaryTag } from "./contracts";

/**
 * Display order of dietary tags. A copy of DIETARY_TAGS from @bite/contracts:
 * importing the value there pulls zod into the guest bundle. diet.test.ts
 * keeps the two in step.
 */
export const DIET_ORDER: readonly DietaryTag[] = [
	"vegetarian",
	"vegan",
	"gluten_free",
	"dairy_free",
	"nut_free",
	"spicy",
];
