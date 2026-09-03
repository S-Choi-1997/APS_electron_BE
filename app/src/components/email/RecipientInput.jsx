import { useEffect, useId, useMemo, useRef, useState } from 'react';
import useDebounce from '../../hooks/useDebounce';
import { useEmailRecipientSuggestions } from '../../hooks/queries/useEmailInquiries';
import './RecipientInput.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_EXTRACT_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function uniqueRecipients(values) {
  const seen = new Set();
  return values
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeEmailAddress(value) {
  const match = String(value || '').trim().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : String(value || '').trim();
}

function parseRecipientText(value) {
  return String(value || '')
    .replace(/\u3000/g, ' ')
    .split(/[,\n;]+/)
    .flatMap((chunk) => {
      const trimmed = chunk.trim();
      if (!trimmed) return [];
      const matches = trimmed.match(EMAIL_EXTRACT_PATTERN);
      if (matches?.length) return matches.map(item => item.trim());
      return trimmed.split(/\s+/).map(item => item.trim()).filter(Boolean);
    });
}

function splitRecipients(value) {
  if (Array.isArray(value)) return uniqueRecipients(value.flatMap(splitRecipients));
  return uniqueRecipients(parseRecipientText(value));
}

function shouldCommitDraft(value, key) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (key === ' ' || key === 'Tab') return EMAIL_PATTERN.test(normalizeEmailAddress(text));
  return true;
}

function flattenExcludedEmails(values) {
  return (Array.isArray(values) ? values : [values])
    .flatMap(value => splitRecipients(value))
    .map(normalizeEmailAddress)
    .filter(Boolean);
}

export default function RecipientInput({
  value,
  onChange,
  disabled = false,
  placeholder = '',
  ariaLabel = '',
  excludedEmails = [],
}) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);
  const listboxId = useId();
  const recipients = useMemo(() => splitRecipients(value), [value]);
  const debouncedDraft = useDebounce(draft.trim(), 200);
  const suggestionQuery = useEmailRecipientSuggestions(debouncedDraft, {
    enabled: focused && open && !disabled,
    limit: 20,
  });
  const excludedSet = useMemo(() => new Set([
    ...flattenExcludedEmails(excludedEmails),
    ...recipients.map(normalizeEmailAddress),
  ]), [excludedEmails, recipients]);
  const suggestions = useMemo(() => (suggestionQuery.data || [])
    .filter(suggestion => !excludedSet.has(normalizeEmailAddress(suggestion.email)))
    .slice(0, 8), [excludedSet, suggestionQuery.data]);
  const showDropdown = focused && open && (
    suggestionQuery.isLoading || suggestionQuery.isError || suggestions.length > 0
  );

  useEffect(() => {
    setActiveIndex(draft.trim() && suggestions.length > 0 ? 0 : -1);
  }, [debouncedDraft, suggestions.length]);

  const updateRecipients = (nextRecipients) => {
    onChange(uniqueRecipients(nextRecipients).join(', '));
  };

  const commitDraft = (rawValue = draft) => {
    const parsed = splitRecipients(rawValue);
    if (parsed.length > 0) updateRecipients([...recipients, ...parsed]);
    setDraft('');
  };

  const selectSuggestion = (suggestion) => {
    if (!suggestion?.email) return;
    updateRecipients([...recipients, suggestion.email]);
    setDraft('');
    setOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const removeRecipient = (index) => {
    updateRecipients(recipients.filter((_, itemIndex) => itemIndex !== index));
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const editRecipient = (index) => {
    const recipient = recipients[index];
    updateRecipients(recipients.filter((_, itemIndex) => itemIndex !== index));
    setDraft(recipient);
    setOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (event) => {
    if (disabled) return;

    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(index => (index + 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(index => (index <= 0 ? suggestions.length - 1 : index - 1));
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && activeIndex >= 0 && suggestions[activeIndex]) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
      return;
    }
    if (['Enter', ',', ';', 'Tab', ' '].includes(event.key) && shouldCommitDraft(draft, event.key)) {
      event.preventDefault();
      commitDraft();
      return;
    }
    if (event.key === 'Backspace' && !draft && recipients.length > 0) {
      event.preventDefault();
      editRecipient(recipients.length - 1);
    }
  };

  const handleChange = (event) => {
    const nextValue = event.target.value;
    setOpen(true);
    if (/[,\n;]/.test(nextValue)) {
      commitDraft(nextValue);
      return;
    }
    setDraft(nextValue);
  };

  const handlePaste = (event) => {
    if (disabled) return;
    const pastedText = event.clipboardData?.getData('text') || '';
    if (!(pastedText.match(EMAIL_EXTRACT_PATTERN) || [])[0]) return;
    event.preventDefault();
    commitDraft(`${draft} ${pastedText}`);
  };

  return (
    <div
      className={`recipient-input ${disabled ? 'disabled' : ''}`}
      onClick={() => inputRef.current?.focus()}
    >
      {recipients.map((recipient, index) => {
        const invalid = !EMAIL_PATTERN.test(normalizeEmailAddress(recipient));
        return (
          <span className={`recipient-chip ${invalid ? 'invalid' : ''}`} key={`${recipient}-${index}`}>
            <button
              type="button"
              className="recipient-chip-text"
              onClick={() => editRecipient(index)}
              disabled={disabled}
              title={`${recipient} 수정`}
            >
              {recipient}
            </button>
            <button
              type="button"
              className="recipient-chip-remove"
              onClick={() => removeRecipient(index)}
              disabled={disabled}
              aria-label={`${recipient} 삭제`}
              title="삭제"
            >
              x
            </button>
          </span>
        );
      })}
      <input
        ref={inputRef}
        className="recipient-input-field"
        value={draft}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={() => {
          setFocused(true);
          setOpen(true);
        }}
        onBlur={() => {
          setFocused(false);
          commitDraft();
        }}
        disabled={disabled}
        placeholder={recipients.length === 0 ? placeholder : ''}
        aria-label={ariaLabel}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
      />
      {showDropdown ? (
        <div className="recipient-suggestions" id={listboxId} role="listbox" aria-label={`${ariaLabel} 추천`}>
          {suggestionQuery.isLoading ? <div className="recipient-suggestion-state">연락처를 불러오는 중...</div> : null}
          {suggestionQuery.isError ? <div className="recipient-suggestion-state error">연락처를 불러오지 못했습니다.</div> : null}
          {!suggestionQuery.isLoading && !suggestionQuery.isError ? suggestions.map((suggestion, index) => (
            <button
              type="button"
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={activeIndex === index}
              className={`recipient-suggestion ${activeIndex === index ? 'active' : ''}`}
              key={suggestion.email}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectSuggestion(suggestion)}
            >
              <span className="recipient-suggestion-identity">
                {suggestion.name ? <strong>{suggestion.name}</strong> : null}
                <span>{suggestion.email}</span>
              </span>
              <span className="recipient-suggestion-source">
                {suggestion.source === 'internal' ? '내부 사용자' : '최근 연락'}
              </span>
            </button>
          )) : null}
        </div>
      ) : null}
    </div>
  );
}
