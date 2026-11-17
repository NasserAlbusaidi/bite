/**
 * Re-export of drizzle-orm's query builders, so every package uses the SAME
 * drizzle instance as the schema. Apps import operators from here, never
 * from "drizzle-orm" directly (pnpm can resolve a second copy when peer
 * deps differ, and then the column types stop matching).
 */
export * from "drizzle-orm";
