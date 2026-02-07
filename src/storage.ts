import fs from "node:fs/promises";
import path from "node:path";

export type AppConfig = {
  passwordHash: string;
  timezone: string; // e.g. "America/Chicago"
  createdAtIso: string;
  updatedAtIso: string;
};

const DATA_DIR = path.resolve(process.cwd(), "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const SCHEDULE_PATH = path.join(DATA_DIR, "schedule.json");

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function isConfigured(): Promise<boolean> {
  try {
    await fs.access(CONFIG_PATH);
    await fs.access(SCHEDULE_PATH);
    return true;
  } catch {
    return false;
  }
}

export async function readConfig(): Promise<AppConfig | null> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as AppConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(cfg: AppConfig): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

export async function readScheduleRaw(): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(SCHEDULE_PATH, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function writeScheduleRaw(schedule: unknown): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(SCHEDULE_PATH, JSON.stringify(schedule, null, 2), "utf8");
}

export function nowIso(): string {
  return new Date().toISOString();
}
