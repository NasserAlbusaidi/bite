import { DIETARY_TAGS } from "@bite/contracts";
import { expect, it } from "vitest";
import { DIET_ORDER } from "./diet";

it("matches the contract's dietary tags", () => {
	expect(DIET_ORDER).toEqual(DIETARY_TAGS);
});
