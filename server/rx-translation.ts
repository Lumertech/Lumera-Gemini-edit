/**
 * Dosage directions use the fixed dictionary.
 * Free-text instructions and advice go to Gemini on Vertex (asia-south1, gemini-3.5-flash-lite)
 * and stay off the patient page until a prescriber approves them.
 */
import type { SqlDatabase } from "./sql-engine.ts";
import { directionLines, isRxLanguage, type RxLanguage } from "../src/lib/rxDirections.ts";
import { vertexGeminiModel, vertexGenerateContent } from "./vertex-gemini.ts";

export type TranslationStatus = "draft" | "approved";

export type StoredTranslation = {
  language: RxLanguage;
  directions: Array<{ drugName: string; directions: string }>;
  instructions: string[];
  advice: string[];
  status: TranslationStatus;
  model: string;
};

type MedicineInput = {
  drugName?: string;
  frequency?: string;
  timing?: string;
  durationDays?: number;
  instructions?: string;
};

export function ensureRxTranslationTable(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rx_translations (
      prescription_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      language TEXT NOT NULL,
      directions_json TEXT NOT NULL,
      instructions_json TEXT NOT NULL,
      advice_json TEXT NOT NULL,
      status TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      approved_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (prescription_id, language)
    )
  `);
}

export function parseTranslationArray(raw: string, expected: number): string[] | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== expected) return null;
    if (!parsed.every((item) => typeof item === "string")) return null;
    return parsed.map((item) => String(item).trim());
  } catch {
    return null;
  }
}

export function translationPrompt(language: RxLanguage, texts: string[]): string {
  const name = language === "hi" ? "Hindi" : language === "mr" ? "Marathi" : "English";
  return [
    `Translate each item into ${name}.`,
    "These are dosage instructions or visit advice.",
    "Return only a JSON array of strings in the same order and length.",
    "Do not add medicine names. If a medicine name is already in an item, copy that name unchanged.",
    JSON.stringify(texts),
  ].join("\n");
}

async function defaultGenerate(texts: string[], language: RxLanguage): Promise<string[]> {
  if (language === "en" || texts.length === 0) return texts;
  const response = await vertexGenerateContent({
    model: vertexGeminiModel(),
    contents: [{ text: translationPrompt(language, texts) }],
  });
  const parsed = parseTranslationArray(String(response.text || ""), texts.length);
  if (!parsed) throw new Error("Translation did not return a JSON array.");
  return parsed;
}

export async function buildTranslation(input: {
  language: RxLanguage;
  medicines: MedicineInput[];
  advice: string[];
  generate?: (texts: string[], language: RxLanguage) => Promise<string[]>;
}): Promise<{ directions: StoredTranslation["directions"]; instructions: string[]; advice: string[]; model: string }> {
  const directions = directionLines(input.medicines, input.language);
  const instructionSource = input.medicines.map((medicine) => String(medicine.instructions || "").trim());
  const adviceSource = input.advice.map((line) => String(line || "").trim()).filter(Boolean);
  if (input.language === "en") {
    return { directions, instructions: instructionSource, advice: adviceSource, model: "" };
  }
  const generate = input.generate || defaultGenerate;
  const combined = [...instructionSource, ...adviceSource];
  const translated = combined.length ? await generate(combined, input.language) : [];
  return {
    directions,
    instructions: translated.slice(0, instructionSource.length),
    advice: translated.slice(instructionSource.length),
    model: vertexGeminiModel(),
  };
}

export function saveTranslation(
  db: SqlDatabase,
  input: { tenantId: string; prescriptionId: string; language: RxLanguage; translation: Awaited<ReturnType<typeof buildTranslation>>; status: TranslationStatus }
): void {
  ensureRxTranslationTable(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO rx_translations (
       prescription_id, tenant_id, language, directions_json, instructions_json, advice_json, status, model, approved_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(prescription_id, language) DO UPDATE SET
       directions_json = excluded.directions_json,
       instructions_json = excluded.instructions_json,
       advice_json = excluded.advice_json,
       status = excluded.status,
       model = excluded.model,
       approved_at = excluded.approved_at,
       updated_at = excluded.updated_at`
  ).run(
    input.prescriptionId,
    input.tenantId,
    input.language,
    JSON.stringify(input.translation.directions),
    JSON.stringify(input.translation.instructions),
    JSON.stringify(input.translation.advice),
    input.status,
    input.translation.model,
    input.status === "approved" ? now : "",
    now
  );
}

export function readTranslation(db: SqlDatabase, tenantId: string, prescriptionId: string, language: string): StoredTranslation | null {
  if (!isRxLanguage(language)) return null;
  ensureRxTranslationTable(db);
  const row = db
    .prepare(
      `SELECT language, directions_json, instructions_json, advice_json, status, model
       FROM rx_translations WHERE prescription_id = ? AND tenant_id = ? AND language = ?`
    )
    .get(prescriptionId, tenantId, language) as
    | { language: string; directions_json: string; instructions_json: string; advice_json: string; status: string; model: string }
    | undefined;
  if (!row || !isRxLanguage(row.language)) return null;
  const parse = (raw: string): unknown[] => {
    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };
  return {
    language: row.language,
    directions: parse(row.directions_json).map((item) => {
      const rowItem = item && typeof item === "object" ? (item as { drugName?: string; directions?: string }) : {};
      return { drugName: String(rowItem.drugName || ""), directions: String(rowItem.directions || "") };
    }),
    instructions: parse(row.instructions_json).map((item) => String(item)),
    advice: parse(row.advice_json).map((item) => String(item)),
    status: row.status === "approved" ? "approved" : "draft",
    model: String(row.model || ""),
  };
}

export function approveTranslation(db: SqlDatabase, tenantId: string, prescriptionId: string, language: string): boolean {
  if (!isRxLanguage(language)) return false;
  ensureRxTranslationTable(db);
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE rx_translations SET status = 'approved', approved_at = ?, updated_at = ?
       WHERE prescription_id = ? AND tenant_id = ? AND language = ? AND status = 'draft'`
    )
    .run(now, now, prescriptionId, tenantId, language);
  return Number(result.changes || 0) === 1;
}

/** Patient-facing copy. AI lines are included only after approval. Drug names stay as stored. */
export function patientFacingTranslation(stored: StoredTranslation | null): {
  language: RxLanguage;
  lines: Array<{ drugName: string; directions: string; instructions: string }>;
  advice: string[];
  aiApproved: boolean;
} | null {
  if (!stored) return null;
  const aiApproved = stored.status === "approved";
  return {
    language: stored.language,
    aiApproved,
    advice: aiApproved ? stored.advice : [],
    lines: stored.directions.map((line, index) => ({
      drugName: line.drugName,
      directions: line.directions,
      instructions: aiApproved ? stored.instructions[index] || "" : "",
    })),
  };
}
