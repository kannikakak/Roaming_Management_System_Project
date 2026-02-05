import assert from "node:assert";
import { buildSchemaChanges } from "../src/utils/schemaChanges";

const previousColumns = ["partner_name", "net_revenue", "billing_date", "legacy_flag"];
const currentColumns = ["roaming_partner_name", "net_revenue", "new_column"];

const schemaChanges = buildSchemaChanges(currentColumns, previousColumns, {
  id: 42,
  name: "previous_upload.csv",
  uploadedAt: "2025-01-15T00:00:00Z",
});

assert.strictEqual(schemaChanges.previousFileId, 42, "Previous file ID should be passed through");
assert.strictEqual(schemaChanges.previousFileName, "previous_upload.csv");
assert.deepStrictEqual(schemaChanges.newColumns, ["new_column"]);
assert(schemaChanges.removedColumns.includes("billing_date"), "Removed columns should include billing_date");
assert(schemaChanges.removedColumns.includes("legacy_flag"));
assert(schemaChanges.renamedColumns.some((rename) => rename.from === "partner_name" && rename.to === "roaming_partner_name"));
assert(schemaChanges.summary.some((line) => line.includes("new column")), "Summary should mention new columns");
assert(schemaChanges.summary.some((line) => line.includes("missing compared to the last upload")), "Summary should mention removed columns");
assert(schemaChanges.summary.some((line) => line.includes("Column renamed")), "Summary should mention renames");
assert(schemaChanges.warnings.some((line) => line.includes("Important columns removed")), "Warning should mention missing important columns");

const firstUpload = buildSchemaChanges(["net_revenue"], [], undefined);
assert.strictEqual(firstUpload.previousFileId, null);
assert(firstUpload.summary.some((line) => line.includes("No earlier upload available")));

console.log("✅ Schema change helper tests passed");
