import express from "express";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

// Initialize Firebase Admin (Cloud Run uses service account by default)
initializeApp({
  storageBucket: process.env.STORAGE_BUCKET,
});

const db = getFirestore();
const bucket = getStorage().bucket(); // default bucket from firebase-admin storage

const RECAPTCHA_API_KEY = process.env.RECAPTCHA_API_KEY;
const RECAPTCHA_PROJECT_ID = process.env.RECAPTCHA_PROJECT_ID || "apsconsulting";
const RECAPTCHA_SITE_KEY = "6LeE3x4sAAAAAAvqktA6CeAWI-YQ1Mw6l_iHd8ks";
const SCORE_THRESHOLD = Number(process.env.SCORE_THRESHOLD || "0.5");
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
const ALLOWED_HOSTNAMES = (process.env.ALLOWED_HOSTNAMES || "").split(",").filter(Boolean);

const app = express();
app.use(express.json({ limit: "1mb" }));

// Health/readiness endpoints (skip CORS)
app.get("/", (_req, res) => res.status(200).send("ok"));
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// Simple CORS middleware for API routes
app.use((req, res, next) => {
  if (req.path === "/" || req.path === "/healthz") return next();

  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).send("");
  }
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).send("");
  next();
});

// In-memory rate limit (per instance)
const rateLimits = new Map();

// Upload signed URL issuance
app.post("/uploadRequest", async (req, res) => {
  if (!req.body?.files) return res.status(400).json({ error: "bad request" });

  const files = req.body.files.slice(0, 5); // max 5
  const urls = [];

  for (const file of files) {
    const rawName = typeof file.name === "string" ? file.name : "file";
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.+/g, ".").slice(0, 120) || "file";
    const filename = `inquiries/${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`;
    const gcsFile = bucket.file(filename);

    const [url] = await gcsFile.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000,
      contentType: file.type || "application/octet-stream",
    });

    urls.push({ name: rawName, uploadUrl: url, filename });
  }

  res.json({ urls });
});

// Contact form submit + reCAPTCHA verify
app.post("/contact", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.ip || "unknown";

  // Rate limit: 10 req/min per IP (per instance)
  const now = Date.now();
  const key = `rate_${ip}`;
  if ((rateLimits.get(key) || 0) > now) {
    rateLimits.set(key + "_c", (rateLimits.get(key + "_c") || 0) + 1);
    if ((rateLimits.get(key + "_c") || 0) > 10) return res.status(429).json({ status: "error", message: "too many requests" });
  } else {
    rateLimits.set(key, now + 60_000);
    rateLimits.set(key + "_c", 1);
  }

  const d = req.body || {};
  const errors = [];
  const trim = s => (typeof s === "string" ? s.trim() : "");

  const name = trim(d.name);
  const phone = trim(d.phone);
  const email = trim(d.email) || null;
  const category = trim(d.category);
  const nationalityRaw = trim(d.nationality).toUpperCase();
  const company = trim(d.company) || null;
  const message = trim(d.message);
  const token = d.recaptchaToken;

  // Category 정규화
  const allowedCategories = ["visa", "stay", "naturalization", "other", "nonprofit", "corporate", "civil", "etc"];
  const normalizedCategory = category.toLowerCase();
  const validCategory = allowedCategories.includes(normalizedCategory) ? normalizedCategory : "";

  // Nationality 검증 (2-3자 국가코드 또는 OTHER)
  const nationality = /^[A-Z]{2,3}$/.test(nationalityRaw) || nationalityRaw === "OTHER" ? nationalityRaw : "";

  // Attachments 파싱 (객체 배열 처리)
  const attachments = Array.isArray(d.attachments)
    ? d.attachments.slice(0, 5).map(item => {
        if (typeof item === "string") {
          return { name: item.slice(0, 200), path: item.slice(0, 300) };
        }
        if (item && typeof item === "object") {
          const safeName = trim(item.name) || "file";
          const path = trim(item.path || item.filename || "");
          const url = trim(item.url || item.uploadUrl || "");
          return {
            name: safeName.slice(0, 200),
            path: path.slice(0, 300) || null,
            url: url.slice(0, 1000) || null,
            type: trim(item.type || "").slice(0, 100) || null,
            size: typeof item.size === "number" ? item.size : null,
          };
        }
        return null;
      }).filter(Boolean)
    : [];

  if (!name || name.length > 100) errors.push("name");
  if (!phone || !/^[0-9\s\-]{7,20}$/.test(phone)) errors.push("phone");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("email");
  if (!validCategory) errors.push("category");
  if (!nationality) errors.push("nationality");
  if (!message || message.length < 10 || message.length > 2000) errors.push("message");
  if (!token) errors.push("reCAPTCHA");
  if (attachments.some(a => (a.name && a.name.length > 200) || (a.path && a.path.length > 300))) errors.push("attachments");

  if (errors.length) return res.status(400).json({ status: "error", message: errors.join(", ") + " invalid" });

  if (!RECAPTCHA_API_KEY) {
    console.error("Missing RECAPTCHA_API_KEY");
    return res.status(500).json({ status: "error", message: "server config error" });
  }

  // reCAPTCHA Enterprise API 호출
  const assessmentUrl = `https://recaptchaenterprise.googleapis.com/v1/projects/${RECAPTCHA_PROJECT_ID}/assessments?key=${RECAPTCHA_API_KEY}`;
  const verifyRes = await fetch(assessmentUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: {
        token: token,
        expectedAction: "contact",
        siteKey: RECAPTCHA_SITE_KEY
      }
    })
  });

  if (!verifyRes.ok) {
    console.error("reCAPTCHA Enterprise API error:", verifyRes.status, await verifyRes.text());
    return res.status(502).json({ status: "error", message: "recaptcha unavailable" });
  }

  const assessment = await verifyRes.json();

  // 디버그 로그
  console.log("=== reCAPTCHA Enterprise Response ===");
  console.log("Full response:", JSON.stringify(assessment, null, 2));

  const tokenProps = assessment.tokenProperties || {};
  const riskAnalysis = assessment.riskAnalysis || {};
  const score = riskAnalysis.score || 0;

  console.log("valid:", tokenProps.valid);
  console.log("action:", tokenProps.action);
  console.log("hostname:", tokenProps.hostname);
  console.log("score:", score);

  if (!tokenProps.valid ||
      tokenProps.action !== "contact" ||
      score < SCORE_THRESHOLD ||
      (ALLOWED_HOSTNAMES.length && !ALLOWED_HOSTNAMES.includes(tokenProps.hostname))) {
    console.warn("reCAPTCHA failed", { ip, score, hostname: tokenProps.hostname, valid: tokenProps.valid });
    return res.status(403).json({ status: "error", message: "recaptcha failed" });
  }

  const now = new Date();
  const deleteDate = new Date(now);
  deleteDate.setDate(deleteDate.getDate() + 179); // 179일 후 자동 삭제 (180일 이내)

  await db.collection("inquiries").add({
    name, phone, email, category: validCategory, nationality, company, message, attachments,
    ip, recaptchaScore: score,
    createdAt: now,
    deleteAt: deleteDate,
    status: "new"
  });

  res.json({ status: "ok", message: "submitted" });
});

// Start server (Cloud Run)
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

