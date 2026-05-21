const db = require('./db');

function parsePaginationParam(value, fallback, { min = 0, max = 500 } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function isAdminRole(role) {
  return ['admin', 'super_admin', 'owner'].includes(String(role || '').toLowerCase());
}

function decorateAuthorName(row) {
  if (!row) return row;
  return {
    ...row,
    author_name: row.author_name || row.author,
    authorName: row.author_name || row.author,
  };
}

function registerRoutes(app, auth) {
function normalizeScheduleType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'company' || normalized === '회사') return 'company';
  if (normalized === 'personal' || normalized === '개인') return 'personal';
  return null;
}

function isValidDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidScheduleTime(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function canModifySchedule(user, schedule) {
  if (isAdminRole(user?.role)) return true;
  if (schedule.type === 'company') return true;
  return schedule.author === user?.email;
}

function canModifyPersonalScheduleTarget(user, schedule, targetType) {
  if (targetType !== 'personal') return true;
  return isAdminRole(user?.role) || schedule.author === user?.email;
}

// GET /schedules - List schedules with filtering
app.get("/schedules", auth.authenticateJWT, async (req, res) => {
  try {
    const { start_date, end_date, type, author, limit = "100", offset = "0" } = req.query;
    const limitNum = parsePaginationParam(limit, 100, { min: 1, max: 500 });
    const offsetNum = parsePaginationParam(offset, 0, { min: 0, max: 100000 });

    if (start_date && !isValidDateOnly(start_date)) {
      return res.status(400).json({ error: "bad_request", message: "시작일 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해 주세요." });
    }
    if (end_date && !isValidDateOnly(end_date)) {
      return res.status(400).json({ error: "bad_request", message: "종료일 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해 주세요." });
    }
    if (start_date && end_date && end_date < start_date) {
      return res.status(400).json({ error: "bad_request", message: "종료일은 시작일과 같거나 이후여야 합니다." });
    }

    const normalizedType = type ? normalizeScheduleType(type) : null;
    if (type && !normalizedType) {
      return res.status(400).json({ error: "bad_request", message: "일정 유형이 올바르지 않습니다." });
    }

    const selectClause = `
      SELECT s.id, s.title, s.time, s.start_date, s.end_date, s.type, s.author,
             s.created_at, s.updated_at,
             COALESCE(u.display_name, s.author) as author_name
    `;
    let fromClause = `
      FROM active_schedules s
      LEFT JOIN users u ON s.author = u.email
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    // Date range filter
    if (start_date) {
      fromClause += ` AND s.end_date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    if (end_date) {
      fromClause += ` AND s.start_date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    // Type filter
    if (normalizedType) {
      fromClause += ` AND s.type = $${paramIndex}`;
      params.push(normalizedType);
      paramIndex++;
    }

    // Author filter
    if (author) {
      fromClause += ` AND s.author = $${paramIndex}`;
      params.push(author);
      paramIndex++;
    }

    const countQuery = `SELECT COUNT(*)::int AS total ${fromClause}`;
    const countResult = await db.query(countQuery, params);
    const total = countResult.rows[0]?.total || 0;

    // Order by start date
    let query = `${selectClause} ${fromClause} ORDER BY s.start_date ASC, s.time NULLS LAST, s.created_at DESC`;

    // Pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum, offsetNum);

    const result = await db.query(query, params);

    res.json({
      status: "ok",
      data: result.rows.map(decorateAuthorName),
      count: result.rows.length,
      total,
      limit: limitNum,
      offset: offsetNum,
      hasMore: offsetNum + result.rows.length < total,
    });
  } catch (error) {
    console.error("Error fetching schedules:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// POST /schedules - Create new schedule
app.post("/schedules", auth.authenticateJWT, async (req, res) => {
  try {
    const { title, time, start_date, end_date, type } = req.body;
    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    const normalizedType = normalizeScheduleType(type);

    if (!trimmedTitle || !start_date || !end_date || !type) {
      return res.status(400).json({
        error: "bad_request",
        message: "제목, 시작일, 종료일, 일정 유형을 입력해 주세요."
      });
    }
    if (!isValidDateOnly(start_date) || !isValidDateOnly(end_date)) {
      return res.status(400).json({ error: "bad_request", message: "날짜 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해 주세요." });
    }
    if (end_date < start_date) {
      return res.status(400).json({ error: "bad_request", message: "종료일은 시작일과 같거나 이후여야 합니다." });
    }
    if (!normalizedType) {
      return res.status(400).json({ error: "bad_request", message: "일정 유형이 올바르지 않습니다." });
    }
    if (!isValidScheduleTime(time)) {
      return res.status(400).json({ error: "bad_request", message: "시간 형식이 올바르지 않습니다. HH:mm 형식으로 입력해 주세요." });
    }

    const insertQuery = `
      INSERT INTO schedules (title, time, start_date, end_date, type, author)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, title, time, start_date, end_date, type, author, created_at, updated_at
    `;

    const result = await db.query(insertQuery, [
      trimmedTitle,
      time || null,
      start_date,
      end_date,
      normalizedType,
      req.user.email,
    ]);

    // Get author_name from users table
    const selectQuery = `
      SELECT s.*, COALESCE(u.display_name, s.author) as author_name
      FROM schedules s
      LEFT JOIN users u ON s.author = u.email
      WHERE s.id = $1
    `;
    const scheduleWithAuthor = await db.query(selectQuery, [result.rows[0].id]);

    const createdSchedule = decorateAuthorName(scheduleWithAuthor.rows[0]);

    if (global.broadcastEvent) {
      global.broadcastEvent('schedule:created', createdSchedule);
    }

    res.json({
      status: "ok",
      data: createdSchedule,
    });
  } catch (error) {
    console.error("Error creating schedule:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// PATCH /schedules/:id - Update schedule
app.patch("/schedules/:id", auth.authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, time, start_date, end_date, type } = req.body;

    const existingResult = await db.query(
      `SELECT id, title, time, start_date, end_date, type, author FROM schedules WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "not_found", message: "일정을 찾을 수 없습니다." });
    }

    const existingSchedule = existingResult.rows[0];
    if (!canModifySchedule(req.user, existingSchedule)) {
      return res.status(403).json({ error: "forbidden", message: "이 일정을 수정할 권한이 없습니다." });
    }

    const nextStartDate = start_date !== undefined ? start_date : existingSchedule.start_date.toISOString?.().slice(0, 10) || String(existingSchedule.start_date).slice(0, 10);
    const nextEndDate = end_date !== undefined ? end_date : existingSchedule.end_date.toISOString?.().slice(0, 10) || String(existingSchedule.end_date).slice(0, 10);
    const nextType = type !== undefined ? normalizeScheduleType(type) : existingSchedule.type;

    if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
      return res.status(400).json({ error: "bad_request", message: "일정 제목을 입력해 주세요." });
    }
    if (start_date !== undefined && !isValidDateOnly(start_date)) {
      return res.status(400).json({ error: "bad_request", message: "시작일 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해 주세요." });
    }
    if (end_date !== undefined && !isValidDateOnly(end_date)) {
      return res.status(400).json({ error: "bad_request", message: "종료일 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해 주세요." });
    }
    if (nextEndDate < nextStartDate) {
      return res.status(400).json({ error: "bad_request", message: "종료일은 시작일과 같거나 이후여야 합니다." });
    }
    if (type !== undefined && !nextType) {
      return res.status(400).json({ error: "bad_request", message: "일정 유형이 올바르지 않습니다." });
    }
    if (time !== undefined && !isValidScheduleTime(time)) {
      return res.status(400).json({ error: "bad_request", message: "시간 형식이 올바르지 않습니다. HH:mm 형식으로 입력해 주세요." });
    }
    if (!canModifyPersonalScheduleTarget(req.user, existingSchedule, nextType)) {
      return res.status(403).json({ error: "forbidden", message: "공유 일정을 개인 일정으로 바꾸려면 작성자 또는 관리자 권한이 필요합니다." });
    }

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      params.push(title.trim());
    }
    if (time !== undefined) {
      updates.push(`time = $${paramIndex++}`);
      params.push(time);
    }
    if (start_date !== undefined) {
      updates.push(`start_date = $${paramIndex++}`);
      params.push(start_date);
    }
    if (end_date !== undefined) {
      updates.push(`end_date = $${paramIndex++}`);
      params.push(end_date);
    }
    if (type !== undefined) {
      updates.push(`type = $${paramIndex++}`);
      params.push(nextType);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "bad_request", message: "수정할 내용이 없습니다." });
    }

    params.push(id);
    const query = `
      UPDATE schedules
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex} AND deleted_at IS NULL
      RETURNING id, title, time, start_date, end_date, type, author, created_at, updated_at
    `;

    const result = await db.query(query, params);

    const selectQuery = `
      SELECT s.*, COALESCE(u.display_name, s.author) as author_name
      FROM schedules s
      LEFT JOIN users u ON s.author = u.email
      WHERE s.id = $1
    `;
    const scheduleWithAuthor = await db.query(selectQuery, [result.rows[0].id]);
    const updatedSchedule = decorateAuthorName(scheduleWithAuthor.rows[0]);

    if (global.broadcastEvent) {
      global.broadcastEvent('schedule:updated', updatedSchedule);
    }

    res.json({
      status: "ok",
      data: updatedSchedule,
    });
  } catch (error) {
    console.error("Error updating schedule:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// DELETE /schedules/:id - Soft delete schedule
app.delete("/schedules/:id", auth.authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;

    const existingResult = await db.query(
      `SELECT id, type, author FROM schedules WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "not_found", message: "일정을 찾을 수 없습니다." });
    }

    if (!canModifySchedule(req.user, existingResult.rows[0])) {
      return res.status(403).json({ error: "forbidden", message: "이 일정을 삭제할 권한이 없습니다." });
    }

    const query = `
      UPDATE schedules
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await db.query(query, [id]);

    if (global.broadcastEvent) {
      global.broadcastEvent('schedule:deleted', { id: result.rows[0].id });
    }

    res.json({
      status: "ok",
      message: "일정을 삭제했습니다.",
    });
  } catch (error) {
    console.error("Error deleting schedule:", error);
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

}

module.exports = {
  registerRoutes,
};
