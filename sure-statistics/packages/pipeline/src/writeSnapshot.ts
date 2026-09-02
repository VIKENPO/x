import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Snapshot } from "@ss/core";

// packages/pipeline/src -> ../../frontend/public/data (= packages/frontend/public/data).
// Resuelto vía import.meta.url para que funcione sin importar el cwd desde el que se lance.
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "frontend", "public", "data");
const HISTORY_DIR = join(DATA_DIR, "history");
const HISTORY_RETENTION_DAYS = 30;

function todayFile(date: Date): string {
  return `${date.toISOString().slice(0, 10)}.json`; // YYYY-MM-DD.json
}

/** Escribe data/latest.json y añade el snapshot al histórico del día. También poda histórico viejo. */
export async function writeSnapshot(snapshot: Snapshot): Promise<void> {
  await mkdir(HISTORY_DIR, { recursive: true });
  await writeFile(join(DATA_DIR, "latest.json"), JSON.stringify(snapshot, null, 2));

  const historyPath = join(HISTORY_DIR, todayFile(new Date(snapshot.generatedAt)));
  const existing: Snapshot[] = await readFile(historyPath, "utf-8")
    .then((raw) => JSON.parse(raw) as Snapshot[])
    .catch(() => []);
  existing.push(snapshot);
  await writeFile(historyPath, JSON.stringify(existing, null, 2));

  await pruneOldHistory();
}

async function pruneOldHistory(): Promise<void> {
  const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = await readdir(HISTORY_DIR).catch(() => [] as string[]);
  for (const file of files) {
    const match = file.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match) continue;
    if (Date.parse(match[1]) < cutoff) await rm(join(HISTORY_DIR, file));
  }
}
