const normalizeKey = (value?: string | null) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const splitIntoTokens = (value: string) => {
  const withSpaces = value.replace(/([a-z])([A-Z])/g, "$1 $2");
  return withSpaces
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
};

const tokenSimilarity = (valueA: string, valueB: string) => {
  const tokensA = new Set(splitIntoTokens(valueA));
  const tokensB = new Set(splitIntoTokens(valueB));
  if (!tokensA.size || !tokensB.size) return 0;
  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
};

export type SchemaRename = {
  from: string;
  to: string;
};

export type SchemaChanges = {
  previousFileId: number | null;
  previousFileName?: string;
  previousUploadedAt?: string;
  newColumns: string[];
  removedColumns: string[];
  renamedColumns: SchemaRename[];
  warnings: string[];
  summary: string[];
};

const IMPORTANT_TERMS = [
  "netrevenue",
  "totalnetrevenue",
  "net_revenue",
  "totalrevenue",
  "revenue",
  "billingvalue",
  "billingamount",
  "roaming_partner",
  "partner",
  "partner_name",
  "operator",
  "network",
  "carrier",
  "mno",
  "plmn",
  "date",
  "event_date",
  "usage_date",
  "billing_date",
  "period",
  "day",
  "timestamp",
  "time",
  "datetime",
  "created_at",
  "start_date",
  "end_date",
];

const IMPORTANT_COLUMN_KEYS = new Set(IMPORTANT_TERMS.map((term) => normalizeKey(term)));

export const buildSchemaChanges = (
  currentColumns: string[],
  previousColumns: string[],
  previousFile?: { id: number; name?: string; uploadedAt?: string | null }
): SchemaChanges => {
  const previousFileId = previousFile?.id ?? null;
  const currentColumnKeyMap = new Map<string, string>();
  currentColumns.forEach((column) => {
    const key = normalizeKey(column);
    if (!currentColumnKeyMap.has(key)) currentColumnKeyMap.set(key, column);
  });
  const previousColumnKeyMap = new Map<string, string>();
  previousColumns.forEach((column) => {
    const key = normalizeKey(column);
    if (!previousColumnKeyMap.has(key)) previousColumnKeyMap.set(key, column);
  });

  const rawNewColumns = previousFileId
    ? currentColumns.filter((column) => !previousColumnKeyMap.has(normalizeKey(column)))
    : [];
  const rawRemovedColumns = previousFileId
    ? previousColumns.filter((column) => !currentColumnKeyMap.has(normalizeKey(column)))
    : [];

  const renamePairs: SchemaRename[] = [];
  const matchedNew = new Set<number>();
  const matchedRemoved = new Set<number>();
  rawNewColumns.forEach((newColumn, newIndex) => {
    let bestScore = 0;
    let bestRemovedIndex = -1;
    rawRemovedColumns.forEach((removedColumn, removedIndex) => {
      if (matchedRemoved.has(removedIndex)) return;
      const score = tokenSimilarity(newColumn, removedColumn);
      if (score > bestScore) {
        bestScore = score;
        bestRemovedIndex = removedIndex;
      }
    });
    if (bestScore >= 0.65 && bestRemovedIndex >= 0) {
      matchedNew.add(newIndex);
      matchedRemoved.add(bestRemovedIndex);
      renamePairs.push({
        from: rawRemovedColumns[bestRemovedIndex],
        to: newColumn,
      });
    }
  });

  const newColumns = rawNewColumns.filter((_, index) => !matchedNew.has(index));
  const removedColumns = rawRemovedColumns.filter((_, index) => !matchedRemoved.has(index));

  const warnings: string[] = [];
  if (previousFileId) {
    const missingImportantKeys = [...IMPORTANT_COLUMN_KEYS].filter(
      (key) => previousColumnKeyMap.has(key) && !currentColumnKeyMap.has(key)
    );
    if (missingImportantKeys.length) {
      warnings.push(
        `Important columns removed: ${missingImportantKeys
          .map((key) => previousColumnKeyMap.get(key) || key)
          .join(", ")}.`
      );
    }
  }

  const summary: string[] = [];
  if (!previousFileId) {
    summary.push("No earlier upload available to compare schema.");
  } else {
    if (!newColumns.length && !removedColumns.length && !renamePairs.length) {
      summary.push("Schema unchanged compared to the previous upload.");
    } else {
      if (newColumns.length) {
        summary.push(
          `${newColumns.length} new column${newColumns.length > 1 ? "s" : ""} detected since the last upload.`
        );
      }
      if (removedColumns.length) {
        summary.push(
          `${removedColumns.length} column${removedColumns.length > 1 ? "s" : ""} missing compared to the last upload.`
        );
      }
      renamePairs.forEach((rename) => {
        summary.push(`Column renamed: ${rename.from} → ${rename.to}.`);
      });
    }
  }

  return {
    previousFileId,
    previousFileName: previousFile?.name,
    previousUploadedAt: previousFile?.uploadedAt ?? undefined,
    newColumns,
    removedColumns,
    renamedColumns: renamePairs,
    warnings,
    summary,
  };
};
