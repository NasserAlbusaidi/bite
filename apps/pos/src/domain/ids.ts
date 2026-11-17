import { v7 } from "uuid";

/**
 * Every row the tablet creates gets a UUIDv7 here, before it ever talks to
 * the server. Time-ordered, so server indexes stay happy, and globally unique,
 * so offline devices never collide and a replayed write is recognizable.
 */
export function newId(): string {
	return v7();
}
