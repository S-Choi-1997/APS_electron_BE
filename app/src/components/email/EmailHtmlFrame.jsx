import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { fetchEmailInlineImage } from '../../services/emailInquiryService';
import './EmailHtmlFrame.css';

const FRAME_MESSAGE = 'aps-email-frame';
const preparedHtmlCache = new Map();

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Inline image conversion failed'));
    reader.readAsDataURL(blob);
  });
}

function getInlineContentId(source = '') {
  const value = String(source).trim();
  if (value.toLowerCase().startsWith('cid:')) return value.slice(4).replace(/^<|>$/g, '');
  if (!value.startsWith('/mail/ImageDisplay')) return '';
  try {
    return new URL(value, 'https://mail.zoho.com').searchParams.get('cid') || '';
  } catch {
    return '';
  }
}

async function prepareEmailHtml(html, emailId) {
  const sanitized = DOMPurify.sanitize(String(html || ''), {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'],
  });
  const template = document.createElement('template');
  template.innerHTML = sanitized;
  template.content.querySelectorAll('base, meta[http-equiv], link').forEach((node) => node.remove());
  template.content.querySelectorAll('a[href]').forEach((anchor) => {
    anchor.removeAttribute('target');
    anchor.removeAttribute('download');
  });

  const references = [];
  template.content.querySelectorAll('[src], [background]').forEach((element) => {
    ['src', 'background'].forEach((attribute) => {
      const contentId = getInlineContentId(element.getAttribute(attribute));
      if (contentId) references.push({ element, attribute, contentId });
    });
  });
  const cache = new Map();
  await Promise.all(references.map(async ({ element, attribute, contentId }) => {
    try {
      if (!cache.has(contentId)) {
        cache.set(contentId, fetchEmailInlineImage(emailId, contentId).then(blobToDataUrl));
      }
      element.setAttribute(attribute, await cache.get(contentId));
    } catch (error) {
      console.warn('[Email] Failed to load inline image:', contentId, error);
      element.removeAttribute(attribute);
    }
  }));

  const bodyHtml = template.innerHTML;
  const bridge = `<script>(function(){
    var send=function(){parent.postMessage({type:'${FRAME_MESSAGE}',kind:'height',height:Math.ceil(document.documentElement.scrollHeight)},'*')};
    document.addEventListener('click',function(event){var link=event.target.closest&&event.target.closest('a[href]');if(!link)return;event.preventDefault();parent.postMessage({type:'${FRAME_MESSAGE}',kind:'link',url:link.href},'*')});
    addEventListener('load',send);new ResizeObserver(send).observe(document.documentElement);setTimeout(send,0);setTimeout(send,500);
  })();<\/script>`;
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    html{background:#fff;color-scheme:light}body{margin:0;min-width:0;background:#fff;overflow-wrap:anywhere}img{max-width:100%!important;height:auto}table{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}*{box-sizing:border-box}
  </style></head><body>${bodyHtml}${bridge}</body></html>`;
  return { bodyHtml, srcDoc };
}

function getPreparedEmailHtml(html, emailId) {
  const key = String(emailId || 'no-id');
  const cached = preparedHtmlCache.get(key);
  if (cached?.sourceHtml === html) return cached.promise;
  const promise = prepareEmailHtml(html, emailId);
  preparedHtmlCache.set(key, { sourceHtml: html, promise });
  if (preparedHtmlCache.size > 20) preparedHtmlCache.delete(preparedHtmlCache.keys().next().value);
  return promise;
}

function EmailHtmlFrame({ html, emailId, title, onExternalLink, onContentReady }) {
  const frameRef = useRef(null);
  const callbackRef = useRef({ onExternalLink, onContentReady });
  const [srcDoc, setSrcDoc] = useState('');
  const [height, setHeight] = useState(300);

  useEffect(() => {
    callbackRef.current = { onExternalLink, onContentReady };
  }, [onContentReady, onExternalLink]);

  useEffect(() => {
    let canceled = false;
    setHeight(300);
    if (!html) {
      setSrcDoc('');
      callbackRef.current.onContentReady?.('');
      return undefined;
    }
    getPreparedEmailHtml(html, emailId).then((prepared) => {
      if (canceled) return;
      setSrcDoc(prepared.srcDoc);
      callbackRef.current.onContentReady?.(prepared.bodyHtml);
    }).catch((error) => {
      console.error('[Email] Failed to prepare HTML document:', error);
      if (!canceled) setSrcDoc('');
    });
    return () => { canceled = true; };
  }, [emailId, html]);

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.source !== frameRef.current?.contentWindow || event.data?.type !== FRAME_MESSAGE) return;
      if (event.data.kind === 'height') setHeight(Math.max(1, Number(event.data.height) || 1));
      if (event.data.kind === 'link' && event.data.url) callbackRef.current.onExternalLink?.(event.data.url);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (!srcDoc) return <div className="email-html-frame-loading">메일 본문을 불러오는 중…</div>;
  return (
    <iframe
      ref={frameRef}
      className="email-html-frame"
      title={title || 'HTML 메일 본문'}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={{ height: `${height}px` }}
    />
  );
}

export default EmailHtmlFrame;
