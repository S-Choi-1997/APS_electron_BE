const admin = require('firebase-admin');
const dbPostgres = require('./db');
const { sendSmsViaRelay } = require('./sms-service');

const INQUIRY_STATUS_VALUES = new Set(['unread', 'read', 'responded']);

function parsePaginationParam(value, fallback, { min = 0, max = 500 } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function firestoreValueToISOString(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function resolveInquiryStatus(data = {}) {
  return data.status === 'new' ? 'unread' : (data.status || (data.check ? 'responded' : 'unread'));
}

function isValidDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function registerRoutes(app, auth, { firestoreDb: db, bucket }) {
  app.use('/inquiries', auth.authenticateJWT);

function mapInquiryDocument(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    createdAt: firestoreValueToISOString(data.createdAt),
    updatedAt: firestoreValueToISOString(data.updatedAt),
    status: resolveInquiryStatus(data),
  };
}

function sendApiError(res, error, fallbackStatus = 500) {
  const statusCode = error.statusCode || fallbackStatus;
  res.status(statusCode).json({
    error: error.errorCode || (statusCode >= 500 ? 'internal_error' : 'bad_request'),
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
  });
}
// GET /inquiries - List all inquiries with optional filtering
app.get("/inquiries", async (req, res) => {
  const startTime = Date.now();
  try {
    const { check, status, category, start_date, end_date, limit = "100", offset = "0" } = req.query;
    const limitNum = parsePaginationParam(limit, 100, { min: 1, max: 500 });
    const offsetNum = parsePaginationParam(offset, 0, { min: 0, max: 100000 });

    if (start_date && !isValidDateOnly(start_date)) {
      return res.status(400).json({ error: "bad_request", message: "Invalid start_date" });
    }
    if (end_date && !isValidDateOnly(end_date)) {
      return res.status(400).json({ error: "bad_request", message: "Invalid end_date" });
    }
    if (start_date && end_date && end_date < start_date) {
      return res.status(400).json({ error: "bad_request", message: "end_date must be greater than or equal to start_date" });
    }

    let query = db.collection("inquiries");

    // Apply filters
    if (check !== undefined) {
      query = query.where("check", "==", check === "true");
    }

    if (category) {
      query = query.where("category", "==", category);
    }

    if (start_date) {
      query = query.where("createdAt", ">=", new Date(`${start_date}T00:00:00+09:00`));
    }

    if (end_date) {
      const endExclusive = new Date(`${end_date}T00:00:00+09:00`);
      endExclusive.setDate(endExclusive.getDate() + 1);
      query = query.where("createdAt", "<", endExclusive);
    }

    const queryStartTime = Date.now();
    const snapshot = await query.get();
    const queryDuration = Date.now() - queryStartTime;

    const filteredInquiries = snapshot.docs
      .map(mapInquiryDocument)
      .filter((inquiry) => !status || inquiry.status === status)
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });

    const total = filteredInquiries.length;
    const inquiries = filteredInquiries.slice(offsetNum, offsetNum + limitNum);

    const duration = Date.now() - startTime;
    console.log(`[Firestore] Query completed in ${queryDuration}ms, total ${duration}ms, returned ${inquiries.length}/${total} items`);

    res.json({
      status: "ok",
      data: inquiries,
      count: inquiries.length,
      total,
      limit: limitNum,
      offset: offsetNum,
      hasMore: offsetNum + inquiries.length < total,
    });
  } catch (error) {
    console.error("Error fetching inquiries:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// GET /inquiries/stats - Get inquiry statistics by status
app.get("/inquiries/stats", async (req, res) => {
  try {
    // Fetch all inquiries to count by status
    const snapshot = await db.collection("inquiries").get();

    let unreadCount = 0;
    let readCount = 0;
    let respondedCount = 0;

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const status = resolveInquiryStatus(data); // Fallback for old data + 'new' → 'unread' migration

      if (status === 'unread') unreadCount++;
      else if (status === 'read') readCount++;
      else if (status === 'responded') respondedCount++;
    });

    const total = snapshot.size;

    res.json({
      status: "ok",
      data: {
        total,
        unread: unreadCount,
        read: readCount,
        responded: respondedCount,
        // Backward compatibility
        website: unreadCount,
        email: 0
      }
    });
  } catch (error) {
    console.error("Error fetching inquiry stats:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// GET /inquiries/all - Get all unchecked inquiries (unified view)
app.get("/inquiries/all", async (req, res) => {
  try {
    const { limit = "100", offset = "0" } = req.query;
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);
    const fetchLimit = limitNum + offsetNum;

    const toISOString = (value) => {
      if (!value) return null;
      if (typeof value.toDate === 'function') return value.toDate().toISOString();
      if (value instanceof Date) return value.toISOString();
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };

    const websiteSnapshot = await db.collection("inquiries").get();
    const websiteRows = websiteSnapshot.docs
      .map((doc) => {
        const data = doc.data();
        const status = data.status === 'new' ? 'unread' : (data.status || (data.check ? 'responded' : 'unread'));

        return {
          inquiry_type: 'web_form',
          id: doc.id,
          customer_name: data.name || data.customerName || data.company || null,
          customer_email: data.email || null,
          phone: data.phone || data.phoneNumber || null,
          title: data.consultation_type || data.type || data.category || data.subject || 'Website inquiry',
          content: data.content || data.message || data.memo || null,
          inquiry_date: toISOString(data.createdAt || data.updatedAt),
          checked: status !== 'unread',
          checked_by: data.checkedBy || data.updatedBy || null,
          checked_at: toISOString(data.checkedAt),
          status,
        };
      })
      .filter((row) => row.status === 'unread');

    const emailResult = await dbPostgres.query(`
      SELECT
        id,
        from_name,
        from_email,
        subject,
        body_text,
        received_at,
        "check",
        status,
        source,
        updated_at
      FROM email_inquiries
      WHERE is_outgoing = false
        AND (status = 'unread' OR ("check" = false AND (status IS NULL OR status = 'unread')))
      ORDER BY received_at DESC
      LIMIT $1 OFFSET 0
    `, [
      fetchLimit,
    ]);
    const emailRows = emailResult.rows.map((row) => ({
      inquiry_type: 'email',
      id: row.id,
      customer_name: row.from_name || null,
      customer_email: row.from_email || null,
      phone: null,
      title: row.subject || 'Email inquiry',
      content: row.body_text || null,
      inquiry_date: toISOString(row.received_at || row.updated_at),
      checked: row.check,
      checked_by: null,
      checked_at: null,
      status: row.status || (row.check ? 'read' : 'unread'),
      source: row.source,
    }));

    const rows = [...websiteRows, ...emailRows]
      .sort((a, b) => new Date(b.inquiry_date || 0) - new Date(a.inquiry_date || 0))
      .slice(offsetNum, offsetNum + limitNum);

    res.json({
      status: "ok",
      data: rows,
      count: rows.length,
    });
  } catch (error) {
    console.error("Error fetching all inquiries:", error);
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
        status: resolveInquiryStatus(data),
        createdAt: firestoreValueToISOString(data.createdAt),
        updatedAt: firestoreValueToISOString(data.updatedAt),
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

    if (updates.status !== undefined && !INQUIRY_STATUS_VALUES.has(updates.status)) {
      return res.status(400).json({
        error: "invalid_status",
        message: "Invalid inquiry status",
        allowed: [...INQUIRY_STATUS_VALUES],
      });
    }

    if (updates.check !== undefined && typeof updates.check !== 'boolean') {
      return res.status(400).json({
        error: "invalid_check",
        message: "check must be a boolean",
      });
    }

    if (
      updates.status !== undefined &&
      updates.check !== undefined &&
      updates.check !== (updates.status !== 'unread')
    ) {
      return res.status(400).json({
        error: "inconsistent_status",
        message: "status and check values are inconsistent",
      });
    }

    // Sync status and check fields for backward compatibility
    if (updates.status !== undefined && updates.check === undefined) {
      // status 업데이트 시 check도 자동 동기화
      updates.check = (updates.status !== 'unread');
    } else if (updates.check !== undefined && updates.status === undefined) {
      // check 업데이트 시 status도 자동 동기화
      updates.status = updates.check ? 'responded' : 'unread';
    }

    // Add updated timestamp
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    updates.updatedBy = req.user.email; // Track who updated (email from JWT)

    const docRef = db.collection("inquiries").doc(id);

    // Check if document exists
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: "not_found", message: "Inquiry not found" });
    }

    await docRef.update(updates);

    if (global.broadcastEvent) {
      const broadcastUpdates = {
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      global.broadcastEvent('consultation:updated', {
        id,
        ...doc.data(),
        ...broadcastUpdates,
      });
    }

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

// POST /inquiries/:id/respond-sms - Send SMS response and mark inquiry responded after provider success
app.post("/inquiries/:id/respond-sms", async (req, res) => {
  try {
    const { id } = req.params;
    const { message, phone, msg_type, title, testmode_yn } = req.body;

    const docRef = db.collection("inquiries").doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: "not_found", message: "Inquiry not found" });
    }

    const inquiry = doc.data();
    const currentStatus = resolveInquiryStatus(inquiry);
    if (currentStatus === 'responded') {
      return res.status(409).json({
        error: "already_responded",
        message: "Inquiry has already been responded to",
      });
    }

    const receiver = phone || inquiry.phone || inquiry.phoneNumber;
    const smsResult = await sendSmsViaRelay({
      receiver,
      msg: message,
      msg_type,
      title,
      testmode_yn,
    }, req.user.email);

    const updates = {
      status: 'responded',
      check: true,
      respondedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.email,
    };

    await docRef.update(updates);

    if (global.broadcastEvent) {
      const broadcastUpdates = {
        ...updates,
        updatedAt: new Date().toISOString(),
        respondedAt: new Date().toISOString(),
      };
      global.broadcastEvent('consultation:updated', {
        id,
        ...inquiry,
        ...broadcastUpdates,
      });
    }

    res.json({
      status: "ok",
      data: {
        inquiryId: id,
        previousStatus: currentStatus,
        updated: {
          status: 'responded',
          check: true,
        },
        sms: smsResult,
      },
    });
  } catch (error) {
    console.error("Inquiry SMS response failed:", error);
    sendApiError(res, error);
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
        // Explicitly exclude content-type from signed headers to avoid CORS issues
        const [url] = await file.getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + 60 * 60 * 1000, // 1 hour
          extensionHeaders: {}, // Prevent content-type from being added to signature
        });

        console.log('[DEBUG] Generated signed URL:', url);
        console.log('[DEBUG] URL contains X-Goog-SignedHeaders:', url.includes('X-Goog-SignedHeaders'));

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

    if (global.broadcastEvent) {
      global.broadcastEvent('consultation:deleted', { id });
    }

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


}

module.exports = {
  registerRoutes,
};
