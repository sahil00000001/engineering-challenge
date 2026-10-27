/**
 * Writes JSON Schema versions of the typed contracts to schemas/, so the input, design
 * configuration and report formats can be read without reading TypeScript.
 * The Zod schemas in src/contracts.ts stay the source of truth.
 *
 *   npm run schemas
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ApprovedContentSchema, DesignConfigSchema, ValidationReportSchema } from "../src/contracts.js";
import { SUBMISSION_DIR } from "../src/paths.js";

const schemas = {
  "approved-content.schema.json": ApprovedContentSchema,
  "design-config.schema.json": DesignConfigSchema,
  "validation-report.schema.json": ValidationReportSchema,
};

for (const [file, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  await writeFile(path.join(SUBMISSION_DIR, "schemas", file), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`schemas/${file}`);
}
