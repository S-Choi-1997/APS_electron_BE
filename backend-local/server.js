/**
 * APS Admin Local Backend Server
 *
 * 로컬 Docker 환경에서 실행되는 백엔드 API 서버
 * GCP2 Cloud Run 코드를 로컬 환경용으로 수정
 *
 * 주요 기능:
 * - Google/Naver OAuth 토큰 검증 및 이메일 기반 접근 제어
 * - 문의 목록 조회/상세/업데이트/삭제 (GCP Firestore)
 * - 첨부파일 서명된 URL 발급 (GCP Storage)
 * - SMS 발송 (Aligo API via GCP3 Relay 서버)
 * - Naver OAuth 토큰 교환
 *
 * 환경변수:
 * - PORT: 서버 포트 (기본값: 3001)
 * - ALLOWED_ORIGINS: CORS 허용 도메인
 * - ALLOWED_EMAILS: 접근 허용 이메일 목록
 * - STORAGE_BUCKET: GCP Storage 버킷
 * - GOOGLE_APPLICATION_CREDENTIALS: GCP 서비스 계정 JSON 경로
 * - NAVER_CLIENT_ID, NAVER_CLIENT_SECRET: Naver OAuth
 * - ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_SENDER_PHONE: Aligo SMS
 * - RELAY_URL: GCP3 SMS Relay 서버 주소
 */

// Load environment variables from .env file
require('dotenv').config();

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// 환경변수 로드 확인
console.log("=".repeat(60));
console.log("🏠 APS Admin LOCAL Backend Server Starting...");
console.log("=".repeat(60));
console.log("Environment Configuration:");
console.log(`- PORT: ${process.env.PORT || 3001}`);
console.log(`- STORAGE_BUCKET: ${process.env.STORAGE_BUCKET || 'Not set'}`);
console.log(`- GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS || 'Not set'}`);
console.log(`- ALLOWED_ORIGINS: ${process.env.ALLOWED_ORIGINS || 'Not set'}`);
console.log(`- ALLOWED_EMAILS: ${process.env.ALLOWED_EMAILS ? '✓ Set' : '✗ Not set'}`);
console.log(`- NAVER_CLIENT_ID: ${process.env.NAVER_CLIENT_ID ? '✓ Set' : '✗ Not set'}`);
console.log(`- RELAY_URL (GCP3): ${process.env.RELAY_URL || 'http://136.113.67.193:3000'}`);
console.log("=".repeat(60));

// Initialize Firebase Admin with service account
try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: process.env.STORAGE_BUCKET || "aps-list.appspot.com",
  });
  console.log("✓ Firebase Admin initialized successfully");
} catch (error) {
  console.error("✗ Failed to initialize Firebase Admin:", error.message);
  console.error("Make sure GOOGLE_APPLICATION_CREDENTIALS is set correctly");
  process.exit(1);
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

const app = express();

// CORS configuration
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const emoji = res.statusCode >= 200 && res.statusCode < 300 ? '✓' : '✗';
    console.log(`${emoji} ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Health check endpoint (no auth required)
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "aps-admin-local-backend",
    version: "1.0.0",
    environment: "local",
  });
});

// Naver OAuth token exchange endpoint (no auth required - validates during exchange)
app.post("/auth/naver/token", async (req, res) => {
  try {
    const { code, state } = req.body;

    if (!code || !state) {
      return res.status(400).json({ error: "bad_request", message: "Missing code or state" });
    }

    const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
    const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
    const NAVER_REDIRECT_URI = process.env.NAVER_REDIRECT_URI;

    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
      console.error("Naver OAuth credentials not configured");
      return res.status(500).json({ error: "server_config_error", message: "Naver OAuth not configured" });
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://nid.naver.com/oauth2.0/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: NAVER_CLIENT_ID,
        client_secret: NAVER_CLIENT_SECRET,
        code: code,
        state: state,
        redirect_uri: NAVER_REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Naver token exchange failed:", errorText);
      return res.status(401).json({ error: "unauthorized", message: "Failed to exchange code for token" });
    }

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error("Naver token error:", tokenData.error_description);
      return res.status(401).json({ error: "unauthorized", message: tokenData.error_description || tokenData.error });
    }

    // Get user info using access token
    const userInfoResponse = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!userInfoResponse.ok) {
      console.error("Failed to get Naver user info");
      return res.status(401).json({ error: "unauthorized", message: "Failed to get user info" });
    }

    const userInfoData = await userInfoResponse.json();

    if (userInfoData.resultcode !== '00') {
      console.error("Naver user info error:", userInfoData.message);
      return res.status(401).json({ error: "unauthorized", message: userInfoData.message || 'Failed to get user info' });
    }

    const profile = userInfoData.response;

    if (!profile.email) {
      console.error("Naver profile does not contain email");
      return res.status(401).json({ error: "unauthorized", message: "Email not provided by Naver" });
    }

    // Check if email is in the whitelist
    const allowedEmails = (process.env.ALLOWED_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean);

    if (allowedEmails.length === 0) {
      console.error("ALLOWED_EMAILS environment variable is not set");
      return res.status(500).json({ error: "server_config_error", message: "Server configuration error" });
    }

    if (!allowedEmails.includes(profile.email)) {
      console.warn(`Access denied for unauthorized Naver email: ${profile.email}`);
      return res.status(403).json({ error: "forbidden", message: "Access denied - unauthorized email" });
    }

    // Return user info and tokens
    res.json({
      status: "ok",
      user: {
        email: profile.email,
        name: profile.name,
        picture: profile.profile_image,
        provider: 'naver',
      },
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
    });
  } catch (error) {
    console.error("Naver token exchange error:", error);
    return res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// Authentication middleware - verifies OAuth access token based on provider
const authenticate = async (req, res, next) => {
  const authStartTime = Date.now();
  try {
    const authHeader = req.headers.authorization;
    const provider = req.headers['x-provider'] || 'google'; // Default to google for backward compatibility

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "unauthorized", message: "Missing or invalid authorization header" });
    }

    const accessToken = authHeader.split("Bearer ")[1];

    let userEmail = null;
    let userName = null;
    let userSub = null;

    // Verify token based on provider
    if (provider === 'google') {
      // Verify Google OAuth access token using Google's tokeninfo endpoint
      const response = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${accessToken}`);

      if (!response.ok) {
        console.error("Google token verification failed:", response.status);
        return res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
      }

      const tokenInfo = await response.json();

      // Check if token has email scope
      if (!tokenInfo.email) {
        console.error("Token does not contain email");
        return res.status(401).json({ error: "unauthorized", message: "Token missing required email scope" });
      }

      // Check if email is verified
      if (tokenInfo.email_verified !== "true" && tokenInfo.email_verified !== true) {
        console.warn("Email not verified:", tokenInfo.email);
        return res.status(403).json({ error: "forbidden", message: "Email not verified" });
      }

      userEmail = tokenInfo.email;
      userName = tokenInfo.name;
      userSub = tokenInfo.sub;
    } else if (provider === 'naver') {
      // Verify Naver OAuth access token using Naver's user info endpoint
      const response = await fetch('https://openapi.naver.com/v1/nid/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        console.error("Naver token verification failed:", response.status);
        return res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
      }

      const data = await response.json();

      if (data.resultcode !== '00') {
        console.error("Naver API error:", data.message);
        return res.status(401).json({ error: "unauthorized", message: "Naver token validation failed" });
      }

      const profile = data.response;

      if (!profile.email) {
        console.error("Naver profile does not contain email");
        return res.status(401).json({ error: "unauthorized", message: "Token missing required email scope" });
      }

      userEmail = profile.email;
      userName = profile.name;
      userSub = profile.id;
    } else {
      console.error("Unsupported provider:", provider);
      return res.status(400).json({ error: "bad_request", message: "Unsupported authentication provider" });
    }

    // Check if email is in the whitelist
    const allowedEmails = (process.env.ALLOWED_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean);

    if (allowedEmails.length === 0) {
      console.error("ALLOWED_EMAILS environment variable is not set");
      return res.status(500).json({ error: "server_config_error", message: "Server configuration error" });
    }

    if (!allowedEmails.includes(userEmail)) {
      console.warn(`Access denied for unauthorized email: ${userEmail} (provider: ${provider})`);
      return res.status(403).json({ error: "forbidden", message: "Access denied - unauthorized email" });
    }

    req.user = {
      email: userEmail,
      sub: userSub,
      name: userName,
      provider: provider,
    };

    const authDuration = Date.now() - authStartTime;
    console.log(`[Auth] ${provider} authentication successful for ${userEmail} (${authDuration}ms)`);

    next();
  } catch (error) {
    console.error("Authentication error:", error);
    return res.status(401).json({ error: "unauthorized", message: "Invalid token" });
  }
};

// Apply authentication to all /inquiries routes
app.use("/inquiries", authenticate);

// GET /inquiries - List all inquiries with optional filtering
app.get("/inquiries", async (req, res) => {
  const startTime = Date.now();
  try {
    const { check, status, category, limit = "100", offset = "0" } = req.query;

    let query = db.collection("inquiries");

    // Apply filters
    if (check !== undefined) {
      query = query.where("check", "==", check === "true");
    }

    if (status) {
      query = query.where("status", "==", status);
    }

    if (category) {
      query = query.where("category", "==", category);
    }

    // Order by creation date (newest first)
    query = query.orderBy("createdAt", "desc");

    // Apply pagination
    const limitNum = parseInt(limit, 10);
    const offsetNum = parseInt(offset, 10);

    if (offsetNum > 0) {
      const offsetSnapshot = await query.limit(offsetNum).get();
      if (!offsetSnapshot.empty) {
        const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
        query = query.startAfter(lastDoc);
      }
    }

    query = query.limit(limitNum);

    const queryStartTime = Date.now();
    const snapshot = await query.get();
    const queryDuration = Date.now() - queryStartTime;

    const inquiries = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      // Convert Firestore Timestamp to ISO string
      createdAt: doc.data().createdAt?.toDate().toISOString(),
      updatedAt: doc.data().updatedAt?.toDate().toISOString(),
    }));

    const duration = Date.now() - startTime;
    console.log(`[Firestore] Query completed in ${queryDuration}ms, total ${duration}ms, returned ${inquiries.length} items`);

    res.json({
      status: "ok",
      data: inquiries,
      count: inquiries.length,
    });
  } catch (error) {
    console.error("Error fetching inquiries:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// GET /inquiries/:id - Get single inquiry by ID
app.get("/inquiries/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const doc = await db.collection("inquiries").doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: "not_found", message: "Inquiry not found" });
    }

    const data = doc.data();

    res.json({
      status: "ok",
      data: {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate().toISOString(),
        updatedAt: data.updatedAt?.toDate().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching inquiry:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// PATCH /inquiries/:id - Update inquiry (check status, notes, etc.)
app.patch("/inquiries/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};

    // Only allow specific fields to be updated
    const allowedFields = ["check", "status", "notes", "assignedTo"];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "bad_request", message: "No valid fields to update" });
    }

    // Add updated timestamp
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    updates.updatedBy = req.user.sub || req.user.email; // Track who updated

    const docRef = db.collection("inquiries").doc(id);

    // Check if document exists
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: "not_found", message: "Inquiry not found" });
    }

    await docRef.update(updates);

    res.json({
      status: "ok",
      message: "Inquiry updated successfully",
      updated: updates,
    });
  } catch (error) {
    console.error("Error updating inquiry:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// GET /inquiries/:id/attachments/urls - Get signed download URLs for all attachments
app.get("/inquiries/:id/attachments/urls", async (req, res) => {
  try {
    const { id } = req.params;

    // Get inquiry document
    const doc = await db.collection("inquiries").doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: "not_found", message: "Inquiry not found" });
    }

    const data = doc.data();
    const attachments = data.attachments || [];

    if (attachments.length === 0) {
      return res.json({
        status: "ok",
        data: [],
      });
    }

    // Generate signed URLs for all attachments
    const urlPromises = attachments.map(async (attachment) => {
      try {
        // Use path or filename from attachment
        const filePath = attachment.path || attachment.filename;

        if (!filePath) {
          return {
            ...attachment,
            downloadUrl: null,
            error: "No file path",
          };
        }

        const file = bucket.file(filePath);

        // Check if file exists
        const [exists] = await file.exists();

        if (!exists) {
          return {
            ...attachment,
            downloadUrl: null,
            error: "File not found in storage",
          };
        }

        // Generate signed URL (valid for 1 hour)
        const [url] = await file.getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + 60 * 60 * 1000, // 1 hour
        });

        return {
          name: attachment.name,
          type: attachment.type,
          size: attachment.size,
          downloadUrl: url,
        };
      } catch (error) {
        console.error(`Error generating URL for ${attachment.name}:`, error);
        return {
          ...attachment,
          downloadUrl: null,
          error: error.message,
        };
      }
    });

    const results = await Promise.all(urlPromises);

    res.json({
      status: "ok",
      data: results,
    });
  } catch (error) {
    console.error("Error generating download URLs:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// DELETE /inquiries/:id - Delete inquiry
app.delete("/inquiries/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const docRef = db.collection("inquiries").doc(id);

    // Check if document exists
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: "not_found", message: "Inquiry not found" });
    }

    const data = doc.data();
    const attachments = Array.isArray(data.attachments) ? data.attachments : [];

    // Delete attachments from Cloud Storage (best-effort; continue on individual errors)
    const attachmentResults = [];
    for (const attachment of attachments) {
      const filePath = attachment.path || attachment.filename;
      if (!filePath) {
        attachmentResults.push({
          name: attachment.name,
          path: null,
          status: "skipped",
          reason: "No file path on attachment",
        });
        continue;
      }

      try {
        await bucket.file(filePath).delete({ ignoreNotFound: true });
        attachmentResults.push({
          name: attachment.name || filePath,
          path: filePath,
          status: "deleted",
        });
      } catch (err) {
        console.error(`Error deleting attachment ${filePath}:`, err);
        attachmentResults.push({
          name: attachment.name || filePath,
          path: filePath,
          status: "error",
          error: err.message,
        });
      }
    }

    await docRef.delete();

    console.log(`[Delete] Inquiry ${id} deleted by ${req.user.email}`);

    res.json({
      status: "ok",
      message: "Inquiry and attachments deleted",
      attachments: attachmentResults,
    });
  } catch (error) {
    console.error("Error deleting inquiry:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// POST /sms/send - Send SMS via Aligo API (through GCP3 relay)
app.post("/sms/send", authenticate, async (req, res) => {
  try {
    const { receiver, msg, msg_type, title, testmode_yn } = req.body;

    // Validate required fields
    if (!receiver || !msg) {
      return res.status(400).json({
        error: "bad_request",
        message: "Missing required fields: receiver, msg"
      });
    }

    // Validate environment variables
    const ALIGO_API_KEY = process.env.ALIGO_API_KEY;
    const ALIGO_USER_ID = process.env.ALIGO_USER_ID;
    const ALIGO_SENDER = process.env.ALIGO_SENDER_PHONE;

    if (!ALIGO_API_KEY || !ALIGO_USER_ID || !ALIGO_SENDER) {
      console.error("Aligo SMS credentials not configured");
      return res.status(500).json({
        error: "server_config_error",
        message: "SMS service not configured"
      });
    }

    // Call GCP3 SMS relay server (VM with fixed IP)
    const RELAY_URL = process.env.RELAY_URL || 'http://136.113.67.193:3000';
    console.log(`[SMS] Sending via GCP3 relay: ${RELAY_URL}/sms/send`);

    const relayPayload = {
      key: ALIGO_API_KEY,
      user_id: ALIGO_USER_ID,
      sender: ALIGO_SENDER,
      receiver: receiver,
      msg: msg,
    };

    // Add optional parameters
    if (msg_type) relayPayload.msg_type = msg_type;
    if (title) relayPayload.title = title;
    if (testmode_yn) relayPayload.testmode_yn = testmode_yn;

    const aligoResponse = await fetch(`${RELAY_URL}/sms/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(relayPayload),
    });

    if (!aligoResponse.ok) {
      const errorText = await aligoResponse.text();
      console.error("Aligo API request failed:", errorText);
      return res.status(500).json({
        error: "sms_provider_error",
        message: "Failed to send SMS"
      });
    }

    const aligoResult = await aligoResponse.json();

    // Check Aligo API result
    if (aligoResult.result_code < 0) {
      console.error("Aligo API error:", aligoResult.message);
      return res.status(500).json({
        error: "sms_failed",
        message: aligoResult.message || "SMS send failed"
      });
    }

    // Log SMS send activity
    console.log(`[SMS] Sent by ${req.user.email}: ${aligoResult.success_cnt} success, ${aligoResult.error_cnt} failed`);

    res.json({
      status: "ok",
      data: {
        msg_id: aligoResult.msg_id,
        success_cnt: aligoResult.success_cnt,
        error_cnt: aligoResult.error_cnt,
        msg_type: aligoResult.msg_type,
      },
    });
  } catch (error) {
    console.error("SMS send error:", error);
    return res.status(500).json({
      error: "internal_error",
      message: error.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log("=".repeat(60));
  console.log(`✓ APS Admin Local Backend Server running on port ${PORT}`);
  console.log(`✓ Health check: http://localhost:${PORT}/`);
  console.log("=".repeat(60));
});
