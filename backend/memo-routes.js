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
  app.get('/memos', auth.authenticateJWT, async (req, res) => {
    try {
      const { search, author, important, active, limit = '50', offset = '0' } = req.query;
      const limitNum = parsePaginationParam(limit, 50, { min: 1, max: 500 });
      const offsetNum = parsePaginationParam(offset, 0, { min: 0, max: 100000 });

      const selectClause = `
        SELECT m.id, m.title, m.content, m.important, m.author,
               m.created_at, m.updated_at, m.expire_date,
               COALESCE(u.display_name, m.author) as author_name
      `;
      let fromClause = `
        FROM memos m
        LEFT JOIN users u ON m.author = u.email
        WHERE m.deleted_at IS NULL
      `;
      const params = [];
      let paramIndex = 1;

      if (search) {
        fromClause += ` AND (m.title ILIKE $${paramIndex} OR m.content ILIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      if (author) {
        fromClause += ` AND m.author = $${paramIndex}`;
        params.push(author);
        paramIndex++;
      }

      if (important !== undefined) {
        fromClause += ` AND m.important = $${paramIndex}`;
        params.push(important === 'true');
        paramIndex++;
      }

      if (active === 'true') {
        fromClause += ' AND (m.expire_date IS NULL OR m.expire_date >= CURRENT_DATE)';
      }

      const countQuery = `SELECT COUNT(*)::int AS total ${fromClause}`;
      const countResult = await db.query(countQuery, params);
      const total = countResult.rows[0]?.total || 0;

      let query = `${selectClause} ${fromClause} ORDER BY m.created_at DESC`;
      query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limitNum, offsetNum);

      const result = await db.query(query, params);

      res.json({
        status: 'ok',
        data: result.rows.map(decorateAuthorName),
        count: result.rows.length,
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + result.rows.length < total,
      });
    } catch (error) {
      console.error('Error fetching memos:', error);
      res.status(500).json({ error: 'internal_error', message: error.message });
    }
  });

  app.get('/memos/:id', auth.authenticateJWT, async (req, res) => {
    try {
      const { id } = req.params;

      const query = `
        SELECT m.*, COALESCE(u.display_name, m.author) as author_name
        FROM memos m
        LEFT JOIN users u ON m.author = u.email
        WHERE m.id = $1 AND m.deleted_at IS NULL
        LIMIT 1
      `;

      const result = await db.query(query, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: '메모를 찾을 수 없습니다.' });
      }

      res.json({
        status: 'ok',
        data: decorateAuthorName(result.rows[0]),
      });
    } catch (error) {
      console.error('Error fetching memo:', error);
      res.status(500).json({ error: 'internal_error', message: error.message });
    }
  });

  app.post('/memos', auth.authenticateJWT, async (req, res) => {
    try {
      const { title, content, important = false, expire_date } = req.body;

      if (!title || !content) {
        return res.status(400).json({
          error: 'bad_request',
          message: '제목과 내용을 입력해 주세요.',
        });
      }

      const insertQuery = `
        INSERT INTO memos (title, content, important, author, expire_date)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, title, content, important, author, created_at, updated_at, expire_date
      `;

      const expireDate = expire_date || new Date().toISOString().split('T')[0];
      const result = await db.query(insertQuery, [
        title,
        content,
        important,
        req.user.email,
        expireDate,
      ]);

      const selectQuery = `
        SELECT m.*, COALESCE(u.display_name, m.author) as author_name
        FROM memos m
        LEFT JOIN users u ON m.author = u.email
        WHERE m.id = $1
      `;
      const memoWithAuthor = await db.query(selectQuery, [result.rows[0].id]);

      const createdMemo = decorateAuthorName(memoWithAuthor.rows[0]);

      if (global.broadcastEvent) {
        global.broadcastEvent('memo:created', createdMemo);
      }

      res.json({
        status: 'ok',
        data: createdMemo,
      });
    } catch (error) {
      console.error('Error creating memo:', error);
      res.status(500).json({ error: 'internal_error', message: error.message });
    }
  });

  app.patch('/memos/:id', auth.authenticateJWT, async (req, res) => {
    try {
      const { id } = req.params;
      const { title, content, important, expire_date } = req.body;

      const existingResult = await db.query(
        'SELECT id, author FROM memos WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
        [id]
      );

      if (existingResult.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: '메모를 찾을 수 없습니다.' });
      }

      if (!isAdminRole(req.user.role) && existingResult.rows[0].author !== req.user.email) {
        return res.status(403).json({ error: 'forbidden', message: '이 메모를 수정할 권한이 없습니다.' });
      }

      const updates = [];
      const params = [];
      let paramIndex = 1;

      if (title !== undefined) {
        updates.push(`title = $${paramIndex++}`);
        params.push(title);
      }
      if (content !== undefined) {
        updates.push(`content = $${paramIndex++}`);
        params.push(content);
      }
      if (important !== undefined) {
        updates.push(`important = $${paramIndex++}`);
        params.push(important);
      }
      if (expire_date !== undefined) {
        updates.push(`expire_date = $${paramIndex++}`);
        params.push(expire_date);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'bad_request', message: '수정할 내용이 없습니다.' });
      }

      params.push(id);
      const query = `
        UPDATE memos
        SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${paramIndex} AND deleted_at IS NULL
        RETURNING id, title, content, important, author, created_at, updated_at, expire_date
      `;

      const result = await db.query(query, params);

      const selectQuery = `
        SELECT m.*, COALESCE(u.display_name, m.author) as author_name
        FROM memos m
        LEFT JOIN users u ON m.author = u.email
        WHERE m.id = $1
      `;
      const memoWithAuthor = await db.query(selectQuery, [result.rows[0].id]);
      const updatedMemo = decorateAuthorName(memoWithAuthor.rows[0]);

      if (global.broadcastEvent) {
        global.broadcastEvent('memo:updated', updatedMemo);
      }

      res.json({
        status: 'ok',
        data: updatedMemo,
      });
    } catch (error) {
      console.error('Error updating memo:', error);
      res.status(500).json({ error: 'internal_error', message: error.message });
    }
  });

  app.delete('/memos/:id', auth.authenticateJWT, async (req, res) => {
    try {
      const { id } = req.params;

      const existingResult = await db.query(
        'SELECT id, author FROM memos WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
        [id]
      );

      if (existingResult.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: '메모를 찾을 수 없습니다.' });
      }

      if (!isAdminRole(req.user.role) && existingResult.rows[0].author !== req.user.email) {
        return res.status(403).json({ error: 'forbidden', message: '이 메모를 삭제할 권한이 없습니다.' });
      }

      const query = `
        UPDATE memos
        SET deleted_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id
      `;

      const result = await db.query(query, [id]);

      if (global.broadcastEvent) {
        global.broadcastEvent('memo:deleted', { id: result.rows[0].id });
      }

      res.json({
        status: 'ok',
        message: '메모를 삭제했습니다.',
      });
    } catch (error) {
      console.error('Error deleting memo:', error);
      res.status(500).json({ error: 'internal_error', message: error.message });
    }
  });
}

module.exports = {
  registerRoutes,
};
