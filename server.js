/**
 * Nexora Admin — server.js
 *
 * All Supabase database operations live here.
 * The frontend (public/index.html) calls /api/* endpoints only —
 * no Supabase credentials are ever exposed to the browser.
 *
 * Environment variables (set in Vercel dashboard or .env):
 *   SUPABASE_URL         — your Supabase project URL
 *   SUPABASE_SERVICE_KEY — service_role key (NOT the anon key)
 *   SESSION_SECRET       — any long random string
 *
 * API Endpoints:
 *   POST   /api/auth/login
 *   POST   /api/auth/logout
 *   GET    /api/auth/me
 *
 *   GET    /api/projects
 *   POST   /api/projects
 *   PATCH  /api/projects/:id
 *   DELETE /api/projects/:id
 *
 *   GET    /api/roles
 *   POST   /api/roles
 *   PATCH  /api/roles/:id
 *   DELETE /api/roles/:id
 *
 *   GET    /api/users
 *
 *   POST   /api/upload
 */

"use strict";

const express  = require("express");
const cors     = require("cors");
const multer   = require("multer");
const path     = require("path");
const crypto   = require("crypto");
const { createClient } = require("@supabase/supabase-js");

// ─── Supabase (service key — server only, never sent to browser) ──────────────
const SUPABASE_URL         = process.env.SUPABASE_URL         || "https://ztghenmbpfetpvwkafno.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const STORAGE_BUCKET       = "project-docs";

if (!SUPABASE_SERVICE_KEY) {
  console.warn("⚠️  SUPABASE_SERVICE_KEY not set — add it to Vercel env vars or .env");
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

// ─── In-memory session store ──────────────────────────────────────────────────
// Swap for Redis/Vercel KV in multi-instance prod if needed.
const SESSION_SECRET = process.env.SESSION_SECRET || "nexora-secret-" + crypto.randomBytes(16).toString("hex");
const sessions = new Map();
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours

function createSession(admin) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { ...admin, expiresAt: Date.now() + SESSION_TTL });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { sessions.delete(token); return null; }
  return s;
}

function destroySession(token) { sessions.delete(token); }

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth  = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const s     = getSession(token);
  if (!s) return res.status(401).json({ error: "Unauthorized" });
  req.admin = s;
  next();
}

// ─── App setup ────────────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: true, methods: ["GET","POST","PATCH","DELETE","OPTIONS"], allowedHeaders: ["Content-Type","Authorization"] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ─── Multer (memory → Supabase Storage) ──────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = [".pdf",".doc",".docx"].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error("Only PDF, DOC, DOCX allowed"), ok);
  }
});

// ─── Error shorthand ─────────────────────────────────────────────────────────
function dbErr(res, err, ctx) {
  console.error(`[${ctx}]`, err.message);
  return res.status(500).json({ error: err.message });
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/auth/login  — { email, password }
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  const { data, error } = await sb
    .from("admins")
    .select("id, email, name, role")
    .eq("email", email.trim().toLowerCase())
    .eq("password", password)   // store hashed passwords in production!
    .single();

  if (error || !data)
    return res.status(401).json({ error: "Invalid credentials" });

  const token = createSession({ id: data.id, email: data.email, name: data.name, role: data.role });
  return res.json({ token, admin: { id: data.id, email: data.email, name: data.name, role: data.role } });
});

// POST /api/auth/logout
app.post("/api/auth/logout", (req, res) => {
  destroySession((req.headers["authorization"] || "").replace("Bearer ", ""));
  return res.json({ ok: true });
});

// GET /api/auth/me
app.get("/api/auth/me", requireAuth, (req, res) => res.json({ admin: req.admin }));

// ═══════════════════════════════════════════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/projects
app.get("/api/projects", requireAuth, async (req, res) => {
  const { data, error } = await sb
    .from("projects").select("*").order("created_at", { ascending: false });
  if (error) return dbErr(res, error, "GET projects");
  return res.json(data);
});

// POST /api/projects
app.post("/api/projects", requireAuth, async (req, res) => {
  const { title, category, completion, status, purpose, description, image_url, doc_url } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "title required" });

  const { data, error } = await sb.from("projects").insert([{
    id: Date.now(),
    title:       title.trim(),
    category:    (category || "General").trim(),
    completion:  parseInt(completion) || 0,
    status:      status   || "Unpaid",
    purpose:     purpose  || "Practice",
    description: (description || "").trim(),
    image_url:   image_url || "https://placehold.co/400x200/13141f/white?text=Project",
    doc_url:     doc_url  || null,
    created_at:  new Date().toISOString()
  }]).select().single();

  if (error) return dbErr(res, error, "POST projects");
  return res.status(201).json(data);
});

// PATCH /api/projects/:id
app.patch("/api/projects/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, category, completion, status, purpose, description, image_url } = req.body;

  const u = {};
  if (title       !== undefined) u.title       = title.trim();
  if (category    !== undefined) u.category    = category.trim();
  if (completion  !== undefined) u.completion  = parseInt(completion) || 0;
  if (status      !== undefined) u.status      = status;
  if (purpose     !== undefined) u.purpose     = purpose;
  if (description !== undefined) u.description = description.trim();
  if (image_url   !== undefined) u.image_url   = image_url;

  const { data, error } = await sb.from("projects").update(u).eq("id", id).select().single();
  if (error) return dbErr(res, error, "PATCH projects");
  return res.json(data);
});

// DELETE /api/projects/:id  — cascades to roles + storage
app.delete("/api/projects/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);

  // Grab doc_url for storage cleanup
  const { data: proj } = await sb.from("projects").select("doc_url").eq("id", id).single();
  if (proj?.doc_url) {
    try {
      const [, filePath] = proj.doc_url.split(`/${STORAGE_BUCKET}/`);
      if (filePath) await sb.storage.from(STORAGE_BUCKET).remove([filePath]);
    } catch (e) { console.warn("Storage cleanup:", e.message); }
  }

  // Delete child roles first
  await sb.from("roles").delete().eq("project_id", id);

  const { error } = await sb.from("projects").delete().eq("id", id);
  if (error) return dbErr(res, error, "DELETE projects");
  return res.json({ ok: true, id });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROLES
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/roles
app.get("/api/roles", requireAuth, async (req, res) => {
  const { data, error } = await sb.from("roles").select("*");
  if (error) return dbErr(res, error, "GET roles");
  return res.json(data);
});

// POST /api/roles
app.post("/api/roles", requireAuth, async (req, res) => {
  const { project_id, role_title, category, description, skills, priority, poster_url } = req.body;
  if (!project_id)      return res.status(400).json({ error: "project_id required" });
  if (!role_title?.trim()) return res.status(400).json({ error: "role_title required" });

  const { data, error } = await sb.from("roles").insert([{
    id:          Date.now(),
    project_id:  parseInt(project_id),
    role_title:  role_title.trim(),
    category:    category    || "Frontend",
    description: (description || "").trim(),
    skills:      (skills      || "").trim(),
    priority:    priority    || "Medium",
    poster_url:  poster_url  || null,
    created_at:  new Date().toISOString()
  }]).select().single();

  if (error) return dbErr(res, error, "POST roles");
  return res.status(201).json(data);
});

// PATCH /api/roles/:id
app.patch("/api/roles/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { role_title, category, description, skills, priority } = req.body;

  const u = {};
  if (role_title   !== undefined) u.role_title   = role_title.trim();
  if (category     !== undefined) u.category     = category;
  if (description  !== undefined) u.description  = description.trim();
  if (skills       !== undefined) u.skills       = skills.trim();
  if (priority     !== undefined) u.priority     = priority;

  const { data, error } = await sb.from("roles").update(u).eq("id", id).select().single();
  if (error) return dbErr(res, error, "PATCH roles");
  return res.json(data);
});

// DELETE /api/roles/:id
app.delete("/api/roles/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { error } = await sb.from("roles").delete().eq("id", id);
  if (error) return dbErr(res, error, "DELETE roles");
  return res.json({ ok: true, id });
});

// ═══════════════════════════════════════════════════════════════════════════
// USERS  (read-only)
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/users
app.get("/api/users", requireAuth, async (req, res) => {
  const { data, error } = await sb
    .from("users")
    .select("id, email, display_name, phone, cv_link, created_at")
    .order("created_at", { ascending: false });
  if (error) return dbErr(res, error, "GET users");
  return res.json(data);
});

// ═══════════════════════════════════════════════════════════════════════════
// FILE UPLOAD  →  Supabase Storage
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/upload  (multipart: field "file", optional "folder")
app.post("/api/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file provided" });

  const folder = req.body.folder || "requirements";
  const ext    = path.extname(req.file.originalname).toLowerCase();
  const name   = `${folder}/${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;

  const { error } = await sb.storage.from(STORAGE_BUCKET).upload(name, req.file.buffer, {
    contentType: req.file.mimetype,
    cacheControl: "3600",
    upsert: false
  });

  if (error) return dbErr(res, error, "POST upload");

  const { data: urlData } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(name);
  return res.json({ url: urlData.publicUrl });
});

// ─── Multer / general error handler ──────────────────────────────────────────
app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Server error" });
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Local dev server ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n✅ Nexora Admin  →  http://localhost:${PORT}`);
    console.log(`   Supabase URL : ${SUPABASE_URL}`);
    console.log(`   Service key  : ${SUPABASE_SERVICE_KEY ? "SET ✓" : "NOT SET ✗  ← add to .env"}\n`);
  });
}

module.exports = app;