function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function joinDisplayValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return String(value || '').trim();
}

function formatAddress(name, email) {
  const displayName = String(name || '').trim();
  const address = String(email || '').trim();
  if (displayName && address && displayName !== address) return `${displayName} <${address}>`;
  return displayName || address || '-';
}

function metaRow(label, value) {
  const displayValue = joinDisplayValue(value) || '-';
  return `
    <div class="mail-print-meta-row">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(displayValue)}</dd>
    </div>`;
}

function renderLabels(labels = []) {
  if (!Array.isArray(labels) || labels.length === 0) return '';
  return `
    <div class="mail-print-tags">
      ${labels.map((label) => `<span>${escapeHtml(label.name || label.labelName || label.id || label.labelId || '')}</span>`).join('')}
    </div>`;
}

function renderAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return '';
  return `
    <section class="mail-print-attachments">
      <h2>첨부파일 ${attachments.length}개</h2>
      <ul>
        ${attachments.map((attachment) => `<li>${escapeHtml(attachment.filename || attachment.name || 'attachment')}</li>`).join('')}
      </ul>
    </section>`;
}

export function buildEmailPrintDocument({
  email,
  subject,
  sanitizedBodyHtml = '',
  bodyText = '',
  statusLabel = '',
  dateText = '',
  printedAtText = '',
  isTranslated = false,
  translatedAtText = '',
  attachments = [],
} = {}) {
  const sender = formatAddress(email?.fromName, email?.from || email?.fromEmail);
  const bodyHtml = sanitizedBodyHtml
    ? `<div class="mail-print-body-html">${sanitizedBodyHtml}</div>`
    : `<pre>${escapeHtml(bodyText || '본문이 없습니다.')}</pre>`;
  const bodyTitle = isTranslated ? '번역 본문' : '메일 본문';

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject || '메일 출력')}</title>
  <style>
    @page { margin: 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #172036;
      font-family: "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.55;
      background: #ffffff;
    }
    .mail-print-document { max-width: 820px; margin: 0 auto; }
    .mail-print-header {
      padding-bottom: 18px;
      border-bottom: 2px solid #4f46e5;
    }
    .mail-print-title {
      margin: 0 0 14px;
      color: #111827;
      font-size: 24px;
      line-height: 1.35;
      font-weight: 800;
    }
    .mail-print-sender {
      margin: 0 0 14px;
      padding: 12px 14px;
      border: 1px solid #d7dcfb;
      border-left: 5px solid #4f46e5;
      border-radius: 8px;
      background: #f6f7ff;
    }
    .mail-print-sender strong {
      display: block;
      margin-bottom: 4px;
      color: #4f46e5;
      font-size: 12px;
    }
    .mail-print-sender span {
      color: #111827;
      font-size: 16px;
      font-weight: 800;
    }
    .mail-print-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 14px;
      margin: 0;
      padding: 12px 14px;
      border: 1px solid #e3e7f0;
      border-radius: 8px;
      background: #f8fafc;
    }
    .mail-print-meta-row {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr);
      gap: 8px;
      min-width: 0;
    }
    .mail-print-meta dt {
      color: #6b7280;
      font-weight: 800;
    }
    .mail-print-meta dd {
      min-width: 0;
      margin: 0;
      color: #1f2937;
      font-weight: 650;
      overflow-wrap: anywhere;
    }
    .mail-print-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }
    .mail-print-tags span {
      padding: 4px 8px;
      border-radius: 999px;
      background: #eef2ff;
      color: #4338ca;
      font-size: 11px;
      font-weight: 800;
    }
    .mail-print-body {
      margin-top: 22px;
    }
    .mail-print-body h2,
    .mail-print-attachments h2 {
      margin: 0 0 10px;
      color: #111827;
      font-size: 15px;
      font-weight: 850;
    }
    .mail-print-body-content {
      min-height: 220px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      color: #111827;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .mail-print-body-content pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: inherit;
    }
    .mail-print-body-html,
    .mail-print-body-html * {
      max-width: 100% !important;
      overflow: visible !important;
      color: inherit;
      font-family: inherit;
      box-sizing: border-box;
    }
    .mail-print-body-html img { max-width: 100% !important; height: auto !important; }
    .mail-print-body-html table {
      width: 100% !important;
      border-collapse: collapse;
      table-layout: auto;
    }
    .mail-print-body-html td,
    .mail-print-body-html th {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .mail-print-attachments {
      margin-top: 22px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
    }
    .mail-print-attachments ul {
      margin: 0;
      padding-left: 18px;
    }
    .mail-print-attachments li {
      margin: 4px 0;
      overflow-wrap: anywhere;
    }
    .mail-print-footer {
      margin-top: 28px;
      color: #6b7280;
      font-size: 11px;
      text-align: right;
    }
    @media print {
      .mail-print-document { max-width: none; }
    }
  </style>
</head>
<body>
  <main class="mail-print-document">
    <header class="mail-print-header">
      <h1 class="mail-print-title">${escapeHtml(subject || '(제목 없음)')}</h1>
      <p class="mail-print-sender">
        <strong>보낸사람</strong>
        <span>${escapeHtml(sender)}</span>
      </p>
      <dl class="mail-print-meta">
        ${metaRow('받는사람', email?.to || email?.toEmail)}
        ${metaRow('참조', email?.cc || email?.ccEmail)}
        ${metaRow('보낸시간', dateText)}
        ${metaRow('상태', statusLabel)}
        ${metaRow('출처', email?.source || 'mail')}
        ${isTranslated ? metaRow('출력본문', translatedAtText ? `${bodyTitle} (${translatedAtText})` : bodyTitle) : metaRow('출력본문', bodyTitle)}
      </dl>
      ${renderLabels(email?.labels)}
    </header>
    <section class="mail-print-body">
      <h2>${escapeHtml(bodyTitle)}</h2>
      <div class="mail-print-body-content">
        ${bodyHtml}
      </div>
    </section>
    ${renderAttachments(attachments)}
    <footer class="mail-print-footer">${printedAtText ? `출력 생성: ${escapeHtml(printedAtText)}` : ''}</footer>
  </main>
</body>
</html>`;
}

export { escapeHtml as escapeEmailPrintHtml };
