import { useEffect, useMemo, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import './RichTextEditor.css';

const InlineImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      inlineImage: {
        default: false,
        parseHTML: element => element.hasAttribute('data-inline-image'),
        renderHTML: attributes => (attributes.inlineImage ? { 'data-inline-image': 'true' } : {}),
      },
    };
  },
});

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textToHtml(value) {
  const text = String(value || '');
  if (!text) return '<p></p>';
  return text.split(/\n{2,}/).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
}

function readInlineImage(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) {
      reject(new Error('이미지 파일만 본문에 넣을 수 있습니다.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      resolve({
        dataUrl,
        attachment: {
          filename: file.name || `inline-image-${Date.now()}.png`,
          name: file.name || `inline-image-${Date.now()}.png`,
          contentType: file.type,
          type: file.type,
          size: file.size,
          contentBase64: dataUrl.split(',').pop(),
          inline: true,
        },
      });
    };
    reader.onerror = () => reject(reader.error || new Error('이미지를 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

function ToolbarButton({ active = false, disabled = false, onClick, children, title }) {
  return (
    <button
      type="button"
      className={`rich-editor-button ${active ? 'active' : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

export default function RichTextEditor({ bodyHtml, bodyText, disabled = false, onChange, onInlineImage, onError }) {
  const imageInputRef = useRef(null);
  const initialContent = useMemo(() => bodyHtml || textToHtml(bodyText), []);
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      InlineImage.configure({ allowBase64: true, inline: false }),
    ],
    content: initialContent,
    editable: !disabled,
    editorProps: {
      attributes: {
        class: 'rich-editor-content',
        'aria-label': '메일 본문',
      },
      handlePaste: (_view, event) => {
        const imageFiles = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
        if (imageFiles.length === 0) return false;
        event.preventDefault();
        Promise.all(imageFiles.map(readInlineImage))
          .then((images) => {
            if (onInlineImage?.(images.map(image => image.attachment)) === false) return;
            images.forEach(({ dataUrl, attachment }) => {
              editor?.chain().focus().setImage({ src: dataUrl, alt: attachment.filename, inlineImage: true }).run();
            });
          })
          .catch(error => onError?.(error.message));
        return true;
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange?.({
        bodyHtml: currentEditor.getHTML(),
        body: currentEditor.getText({ blockSeparator: '\n' }),
      });
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) return;
    const nextHtml = bodyHtml || textToHtml(bodyText);
    if (nextHtml !== editor.getHTML()) editor.commands.setContent(nextHtml, false);
  }, [bodyHtml, bodyText, editor]);

  const insertImages = async (files) => {
    try {
      const images = await Promise.all(Array.from(files || []).map(readInlineImage));
      if (onInlineImage?.(images.map(image => image.attachment)) === false) return;
      images.forEach(({ dataUrl, attachment }) => {
        editor?.chain().focus().setImage({ src: dataUrl, alt: attachment.filename, inlineImage: true }).run();
      });
    } catch (error) {
      onError?.(error.message || '이미지를 읽지 못했습니다.');
    }
  };

  const setLink = () => {
    const previous = editor?.getAttributes('link').href || '';
    const href = window.prompt('링크 주소를 입력하세요.', previous);
    if (href === null) return;
    if (!href.trim()) editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor?.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  };

  return (
    <div className={`rich-editor ${disabled ? 'disabled' : ''}`}>
      <div className="rich-editor-toolbar" role="toolbar" aria-label="본문 서식">
        <ToolbarButton title="굵게" active={editor?.isActive('bold')} disabled={disabled} onClick={() => editor?.chain().focus().toggleBold().run()}>B</ToolbarButton>
        <ToolbarButton title="기울임" active={editor?.isActive('italic')} disabled={disabled} onClick={() => editor?.chain().focus().toggleItalic().run()}><em>I</em></ToolbarButton>
        <ToolbarButton title="밑줄" active={editor?.isActive('underline')} disabled={disabled} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></ToolbarButton>
        <ToolbarButton title="글머리 목록" active={editor?.isActive('bulletList')} disabled={disabled} onClick={() => editor?.chain().focus().toggleBulletList().run()}>• 목록</ToolbarButton>
        <ToolbarButton title="번호 목록" active={editor?.isActive('orderedList')} disabled={disabled} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1. 목록</ToolbarButton>
        <ToolbarButton title="링크" active={editor?.isActive('link')} disabled={disabled} onClick={setLink}>링크</ToolbarButton>
        <ToolbarButton title="본문 이미지" disabled={disabled} onClick={() => imageInputRef.current?.click()}>이미지</ToolbarButton>
        <input
          ref={imageInputRef}
          className="rich-editor-image-input"
          type="file"
          accept="image/*"
          multiple
          disabled={disabled}
          onChange={(event) => {
            const files = event.target.files;
            event.target.value = '';
            insertImages(files);
          }}
        />
      </div>
      <EditorContent editor={editor} />
      <p className="rich-editor-hint">이미지는 이 영역에 붙여넣기(Ctrl+V)하거나 ‘이미지’로 넣을 수 있습니다.</p>
    </div>
  );
}
