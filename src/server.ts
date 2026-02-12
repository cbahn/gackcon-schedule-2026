import express from "express";
import path from "node:path";
import bcrypt from "bcryptjs";
import { engine } from "express-handlebars";
import { DateTime } from "luxon";

import {
  ensureDataDir,
  isConfigured,
  readConfig,
  writeConfig,
  readScheduleRaw,
  writeScheduleRaw,
  readConnectionsRaw,
  writeConnectionsRaw,
  nowIso
} from "./storage.js";
import { normalizeSchedule } from "./schedule.js";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));

app.use("/public", express.static(path.resolve(process.cwd(), "public")));

app.engine("hbs", engine({
  extname: ".hbs",
  defaultLayout: "main",
  layoutsDir: path.resolve(process.cwd(), "views", "layouts"),
  helpers: {
    json: (context: unknown) => JSON.stringify(context),
    eq: (a: unknown, b: unknown) => a === b
  }
}));
app.set("view engine", "hbs");
app.set("views", path.resolve(process.cwd(), "views"));

function validTimezoneOrNull(tz: string): string | null {
  // Luxon will treat unknown zones as invalid.
  const dt = DateTime.now().setZone(tz);
  return dt.isValid ? tz : null;
}

function parseJsonFromTextarea(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const val = JSON.parse(text);
    return { ok: true, value: val };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid JSON" };
  }
}

function parseMultipart(req: express.Request): { fields: Record<string, string>; files: Record<string, string> } | null {
  const contentType = req.headers["content-type"];
  if (!contentType || !contentType.startsWith("multipart/form-data")) return null;
  if (!Buffer.isBuffer(req.body)) return null;

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) return null;

  const delimiter = `--${boundary}`;
  const bodyText = req.body.toString("latin1");
  const chunks = bodyText.split(delimiter).slice(1, -1);
  const fields: Record<string, string> = {};
  const files: Record<string, string> = {};

  for (const chunk of chunks) {
    const part = chunk.startsWith("\r\n") ? chunk.slice(2) : chunk;
    const splitAt = part.indexOf("\r\n\r\n");
    if (splitAt === -1) continue;

    const headerText = part.slice(0, splitAt);
    let dataText = part.slice(splitAt + 4);
    if (dataText.endsWith("\r\n")) dataText = dataText.slice(0, -2);

    const dispositionLine = headerText
      .split("\r\n")
      .find(line => line.toLowerCase().startsWith("content-disposition:"));
    if (!dispositionLine) continue;

    const nameMatch = dispositionLine.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];

    const isFile = /filename="/i.test(dispositionLine);
    const value = Buffer.from(dataText, "latin1").toString("utf8");
    if (isFile) files[fieldName] = value;
    else fields[fieldName] = value;
  }

  return { fields, files };
}

app.get("/", async (_req, res) => {
  if (!(await isConfigured())) return res.redirect("/setup");

  const cfg = await readConfig();
  const raw = await readScheduleRaw();
  if (!cfg || raw === null) return res.redirect("/setup");

  const { events, warnings } = normalizeSchedule(raw, cfg.timezone);

  const byDay = {
    friday: events.filter(e => e.dayKey === "friday"),
    saturday: events.filter(e => e.dayKey === "saturday"),
    sunday: events.filter(e => e.dayKey === "sunday"),
    other: events.filter(e => e.dayKey === "other")
  };

  res.render("schedule", {
    timezone: cfg.timezone,
    byDay,
    warnings
  });
});

app.get("/connections", async (_req, res) => {
  if (!(await isConfigured())) return res.redirect("/setup");

  const content = await readConnectionsRaw();
  res.render("connections", {
    connectionsHtml: content
  });
});

app.get("/setup", async (_req, res) => {
  if (await isConfigured()) return res.redirect("/");
  res.render("setup", { timezoneDefault: "America/Chicago" });
});

app.post("/setup", async (req, res) => {
  if (await isConfigured()) return res.redirect("/");

  const scheduleText = String(req.body.scheduleJson ?? "");
  const password = String(req.body.adminPassword ?? "");
  const timezone = String(req.body.timezone ?? "");

  const tz = validTimezoneOrNull(timezone);
  if (!tz) {
    return res.status(400).render("setup", {
      error: "That timezone doesn’t look valid. Try something like America/Chicago.",
      scheduleJson: scheduleText,
      timezoneDefault: timezone || "America/Chicago"
    });
  }

  if (password.length < 8) {
    return res.status(400).render("setup", {
      error: "Admin password must be at least 8 characters.",
      scheduleJson: scheduleText,
      timezoneDefault: tz
    });
  }

  const parsed = parseJsonFromTextarea(scheduleText);
  if (!parsed.ok) {
    return res.status(400).render("setup", {
      error: `Invalid JSON: ${parsed.error}`,
      scheduleJson: scheduleText,
      timezoneDefault: tz
    });
  }

  await ensureDataDir();

  const passwordHash = await bcrypt.hash(password, 12);
  const now = nowIso();

  await writeConfig({
    passwordHash,
    timezone: tz,
    createdAtIso: now,
    updatedAtIso: now
  });

  await writeScheduleRaw(parsed.value);

  return res.redirect("/");
});

app.get("/edit", async (_req, res) => {
  if (!(await isConfigured())) return res.redirect("/setup");

  const cfg = await readConfig();
  const raw = await readScheduleRaw();
  if (!cfg || raw === null) return res.redirect("/setup");

  res.render("edit", {
    timezone: cfg.timezone,
    scheduleJson: JSON.stringify(raw, null, 2)
  });
});

app.get("/connections/edit", async (_req, res) => {
  if (!(await isConfigured())) return res.redirect("/setup");

  const content = await readConnectionsRaw();
  res.render("connections-edit", {
    connectionsHtml: content
  });
});

app.post("/edit", async (req, res) => {
  if (!(await isConfigured())) return res.redirect("/setup");

  const cfg = await readConfig();
  if (!cfg) return res.redirect("/setup");

  const scheduleText = String(req.body.scheduleJson ?? "");
  const password = String(req.body.adminPassword ?? "");

  const ok = await bcrypt.compare(password, cfg.passwordHash);

  // tiny “cheap” slowdown on failures
  if (!ok) {
    await new Promise(r => setTimeout(r, 350));
    const raw = await readScheduleRaw();
    return res.status(403).render("edit", {
      timezone: cfg.timezone,
      scheduleJson: scheduleText || JSON.stringify(raw ?? [], null, 2),
      error: "Wrong admin password."
    });
  }

  const parsed = parseJsonFromTextarea(scheduleText);
  if (!parsed.ok) {
    return res.status(400).render("edit", {
      timezone: cfg.timezone,
      scheduleJson: scheduleText,
      error: `Invalid JSON: ${parsed.error}`
    });
  }

  await writeScheduleRaw(parsed.value);
  await writeConfig({ ...cfg, updatedAtIso: nowIso() });

  return res.redirect("/");
});

app.post("/connections/edit", express.raw({ type: "multipart/form-data", limit: "1mb" }), async (req, res) => {
  if (!(await isConfigured())) return res.redirect("/setup");

  const cfg = await readConfig();
  if (!cfg) return res.redirect("/setup");

  const parsed = parseMultipart(req);
  if (!parsed) {
    const content = await readConnectionsRaw();
    return res.status(400).render("connections-edit", {
      connectionsHtml: content,
      error: "Invalid upload payload."
    });
  }

  const password = parsed.fields.adminPassword ?? "";
  const uploadContent = parsed.files.connectionsFile;
  if (uploadContent === undefined) {
    const content = await readConnectionsRaw();
    return res.status(400).render("connections-edit", {
      connectionsHtml: content,
      error: "Please upload a file."
    });
  }

  const ok = await bcrypt.compare(password, cfg.passwordHash);

  if (!ok) {
    await new Promise(r => setTimeout(r, 350));
    return res.status(403).render("connections-edit", {
      connectionsHtml: uploadContent,
      error: "Wrong admin password."
    });
  }

  await writeConnectionsRaw(uploadContent);
  await writeConfig({ ...cfg, updatedAtIso: nowIso() });

  return res.redirect("/connections");
});

app.get("/healthz", (_req, res) => {
  res.type("text").send("ok\n");
});

app.listen(PORT, () => {
  console.log(`Schedule site listening on http://localhost:${PORT}`);
});
