const { query } = require('./db');

const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_TRANSLATION_MODEL =
  process.env.OPENROUTER_TRANSLATION_MODEL || 'google/gemini-3.1-flash-lite';
const OPENROUTER_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 45000);
const MAX_TRANSLATION_CHARS = Number(process.env.EMAIL_TRANSLATION_MAX_CHARS || 12000);

const inFlightTranslations = new Set();

function stripHtml(value = '') {
  return String(value)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function truncateForTranslation(value = '') {
  const text = String(value || '').trim();
  if (text.length <= MAX_TRANSLATION_CHARS) return text;
  return `${text.slice(0, MAX_TRANSLATION_CHARS)}\n\n[본문이 길어 앞부분만 번역되었습니다.]`;
}

function analyzeLanguage(text = '') {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const hangul = (normalized.match(/[가-힣]/g) || []).length;
  const latin = (normalized.match(/[A-Za-z]/g) || []).length;
  const japanese = (normalized.match(/[\u3040-\u30ff]/g) || []).length;
  const cjk = (normalized.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
  const letters = hangul + latin + japanese + cjk;
  const hangulRatio = letters > 0 ? hangul / letters : 0;

  if (letters < 20) {
    return { shouldTranslate: false, detectedLanguage: hangul > 0 ? 'ko' : 'unknown', reason: 'too_short' };
  }

  if (hangulRatio >= 0.18) {
    return { shouldTranslate: false, detectedLanguage: 'ko', reason: 'mostly_korean' };
  }

  if (latin + japanese + cjk - hangul >= 20) {
    return {
      shouldTranslate: true,
      detectedLanguage: japanese > 0 ? 'ja' : cjk > hangul ? 'zh' : 'non-ko',
      reason: 'non_korean_text',
    };
  }

  return { shouldTranslate: false, detectedLanguage: 'unknown', reason: 'no_translatable_text' };
}

function extractJson(content = '') {
  const text = String(content || '').trim();
  if (!text) throw new Error('empty translation response');

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace
    ? candidate.slice(firstBrace, lastBrace + 1)
    : candidate;

  return JSON.parse(jsonText);
}

async function ensureEmailTranslationSchema() {
  const sql = `
    ALTER TABLE email_inquiries
      ADD COLUMN IF NOT EXISTS detected_language VARCHAR(32),
      ADD COLUMN IF NOT EXISTS translation_status VARCHAR(20) DEFAULT 'not_required',
      ADD COLUMN IF NOT EXISTS translated_subject TEXT,
      ADD COLUMN IF NOT EXISTS translated_body_text TEXT,
      ADD COLUMN IF NOT EXISTS translation_model VARCHAR(120),
      ADD COLUMN IF NOT EXISTS translation_error TEXT,
      ADD COLUMN IF NOT EXISTS translated_at TIMESTAMP;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'email_inquiries_translation_status_check'
      ) THEN
        ALTER TABLE email_inquiries
          ADD CONSTRAINT email_inquiries_translation_status_check
          CHECK (translation_status IN ('not_required', 'pending', 'completed', 'failed', 'disabled'));
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_email_inquiries_translation_status
      ON email_inquiries(translation_status);
  `;

  await query(sql);
  console.log('[Email Translation] Schema ready');
}

async function updateTranslationState(emailId, patch) {
  const assignments = [];
  const values = [];
  let paramIndex = 1;

  for (const [column, value] of Object.entries(patch)) {
    assignments.push(`${column} = $${paramIndex++}`);
    values.push(value);
  }

  assignments.push('updated_at = NOW()');
  values.push(emailId);

  const sql = `
    UPDATE email_inquiries
    SET ${assignments.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *;
  `;

  const result = await query(sql, values);
  return result.rows[0] || null;
}

async function callOpenRouterTranslation({ subject, body, detectedLanguage }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://apsconsulting.kr',
          'X-Title': process.env.OPENROUTER_APP_TITLE || 'APS Admin Email Translation',
        },
        body: JSON.stringify({
          model: OPENROUTER_TRANSLATION_MODEL,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You translate business consultation emails into natural Korean. Preserve names, numbers, URLs, product names, line breaks, and the original intent. Return only strict valid JSON with escaped newlines and quotes.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                task: attempt === 1
                  ? 'Translate this non-Korean email into Korean.'
                  : 'Retry. Return minified strict JSON only. Do not include markdown.',
                expectedJson: {
                  detectedLanguage: 'ISO-like language name or code',
                  translatedSubject: 'Korean subject',
                  translatedBody: 'Korean body text',
                },
                initiallyDetectedLanguage: detectedLanguage,
                subject,
                body,
              }),
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`OpenRouter HTTP ${response.status}: ${errorBody.slice(0, 300)}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      const parsed = extractJson(content);

      return {
        detectedLanguage: String(parsed.detectedLanguage || parsed.language || detectedLanguage || 'non-ko').slice(0, 32),
        translatedSubject: String(parsed.translatedSubject || parsed.subject || subject || '').trim(),
        translatedBody: String(parsed.translatedBody || parsed.body || '').trim(),
      };
    } catch (error) {
      lastError = error;
      if (attempt >= 2 || error.name === 'AbortError') {
        throw error;
      }
      console.warn(`[Email Translation] OpenRouter response parse/request failed; retrying once. ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error('OpenRouter translation failed');
}

async function getTranslationBody(email) {
  const storedBody = stripHtml(email.body_text || email.body_html || '');

  if (email.source !== 'zoho' || !email.message_id || !email.folder_id) {
    return storedBody;
  }

  try {
    const { fetchMessageContent } = require('./zoho/mail-api');
    const fullContent = await fetchMessageContent(email.message_id, email.folder_id);
    const fullBody = stripHtml(fullContent || '');

    if (fullBody.length > storedBody.length) {
      console.log(`[Email Translation] Using full ZOHO content for email ${email.id} (${storedBody.length} -> ${fullBody.length} chars)`);
      return fullBody;
    }
  } catch (error) {
    console.warn(`[Email Translation] Full content fetch failed for email ${email.id}; using stored body. ${error.message}`);
  }

  return storedBody;
}

async function translateEmailById(emailId, options = {}) {
  const id = Number(emailId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid email id');
  }

  if (inFlightTranslations.has(id)) {
    const result = await query('SELECT * FROM email_inquiries WHERE id = $1 LIMIT 1;', [id]);
    return result.rows[0] || null;
  }

  inFlightTranslations.add(id);

  try {
    const result = await query('SELECT * FROM email_inquiries WHERE id = $1 LIMIT 1;', [id]);
    const email = result.rows[0];
    if (!email) return null;

    if (email.is_outgoing) {
      return updateTranslationState(id, {
        translation_status: 'not_required',
        detected_language: 'ko',
        translation_error: null,
      });
    }

    if (!options.force && email.translation_status === 'completed') {
      return email;
    }

    const plainBody = await getTranslationBody(email);
    const combined = [email.subject, plainBody].filter(Boolean).join('\n\n');
    const analysis = analyzeLanguage(combined);

    if (!analysis.shouldTranslate) {
      return updateTranslationState(id, {
        translation_status: 'not_required',
        detected_language: analysis.detectedLanguage,
        translation_error: null,
      });
    }

    if (!process.env.OPENROUTER_API_KEY) {
      return updateTranslationState(id, {
        translation_status: 'disabled',
        detected_language: analysis.detectedLanguage,
        translation_model: OPENROUTER_TRANSLATION_MODEL,
        translation_error: 'OPENROUTER_API_KEY is not configured',
      });
    }

    await updateTranslationState(id, {
      translation_status: 'pending',
      detected_language: analysis.detectedLanguage,
      translation_model: OPENROUTER_TRANSLATION_MODEL,
      translation_error: null,
    });

    const translated = await callOpenRouterTranslation({
      subject: truncateForTranslation(email.subject || ''),
      body: truncateForTranslation(plainBody),
      detectedLanguage: analysis.detectedLanguage,
    });

    return updateTranslationState(id, {
      translation_status: 'completed',
      detected_language: translated.detectedLanguage,
      translated_subject: translated.translatedSubject,
      translated_body_text: translated.translatedBody,
      translation_model: OPENROUTER_TRANSLATION_MODEL,
      translation_error: null,
      translated_at: new Date(),
    });
  } catch (error) {
    console.error('[Email Translation] Failed:', error.message);
    const failed = await updateTranslationState(id, {
      translation_status: 'failed',
      translation_model: OPENROUTER_TRANSLATION_MODEL,
      translation_error: error.message.slice(0, 1000),
    }).catch(() => null);
    return failed;
  } finally {
    inFlightTranslations.delete(id);
  }
}

function scheduleEmailTranslation(emailId, options = {}) {
  setImmediate(async () => {
    const translated = await translateEmailById(emailId, options);
    if (translated && global.broadcastEvent) {
      global.broadcastEvent('email:updated', {
        id: translated.id,
        translationStatus: translated.translation_status,
        detectedLanguage: translated.detected_language,
        translatedAt: translated.translated_at,
      });
    }
  });
}

module.exports = {
  analyzeLanguage,
  ensureEmailTranslationSchema,
  scheduleEmailTranslation,
  stripHtml,
  translateEmailById,
};
