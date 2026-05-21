const db = require('./db');

function isUndefinedTableError(error) {
  return error?.code === '42P01';
}

function registerRoutes(app, auth) {
// ============================================
// WEB FORM INQUIRIES API (PostgreSQL - Firestore polling)
// ============================================

// GET /web-form-inquiries - List web form inquiries
app.get("/web-form-inquiries", auth.authenticateJWT, async (req, res) => {
  try {
    const { checked, consultation_type, limit = "100", offset = "0" } = req.query;

    let query = `
      SELECT id, name, email, phone, consultation_type, content,
             preferred_contact, consent_privacy, created_at, synced_at,
             checked, checked_by, checked_at, notes, ip_address, user_agent
      FROM web_form_inquiries
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (checked !== undefined) {
      query += ` AND checked = $${paramIndex}`;
      params.push(checked === 'true');
      paramIndex++;
    }

    if (consultation_type) {
      query += ` AND consultation_type = $${paramIndex}`;
      params.push(consultation_type);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await db.query(query, params);

    res.json({
      status: "ok",
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    if (isUndefinedTableError(error)) {
      console.warn('[Web Form Inquiries] web_form_inquiries table is missing; returning empty list');
      return res.json({
        status: "ok",
        data: [],
        count: 0,
        warning: "web_form_inquiries table is not configured",
      });
    }

    console.error("Error fetching web form inquiries:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// PATCH /web-form-inquiries/:id - Update web form inquiry (mark as checked)
app.patch("/web-form-inquiries/:id", auth.authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { checked, notes } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (checked !== undefined) {
      updates.push(`checked = $${paramIndex++}`);
      params.push(checked);

      if (checked) {
        updates.push(`checked_by = $${paramIndex++}`);
        params.push(req.user.email);
        updates.push(`checked_at = CURRENT_TIMESTAMP`);
      }
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      params.push(notes);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "bad_request", message: "No fields to update" });
    }

    params.push(id);
    const query = `
      UPDATE web_form_inquiries
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "not_found", message: "Web form inquiry not found" });
    }

    res.json({
      status: "ok",
      data: result.rows[0],
    });
  } catch (error) {
    if (isUndefinedTableError(error)) {
      console.warn('[Web Form Inquiries] web_form_inquiries table is missing; update rejected');
      return res.status(503).json({
        error: "web_form_inquiries_unavailable",
        message: "Web form inquiry storage is not configured",
      });
    }

    console.error("Error updating web form inquiry:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

}

module.exports = {
  registerRoutes,
};
