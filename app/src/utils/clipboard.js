export async function copyTextToClipboard(text) {
  if (!text) return false;

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.warn('[Clipboard] navigator.clipboard failed, trying fallback:', error);
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand('copy');
  } catch (error) {
    console.error('[Clipboard] fallback copy failed:', error);
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export function htmlToPlainText(html) {
  if (!html) return '';

  const container = document.createElement('div');
  container.innerHTML = html;
  return (container.innerText || container.textContent || '').trim();
}
