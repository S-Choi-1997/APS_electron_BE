import './ConsultationTable.css';
import { useEffect, useRef } from 'react';

const TYPE_COLORS = ['#2563eb', '#dc2626', '#f59e0b', '#16a34a']; // blue, red, yellow, green

const getTypeColor = (type = '') => {
  const sum = type.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return TYPE_COLORS[sum % TYPE_COLORS.length];
};

const hexToRgba = (hex, alpha) => {
  const sanitized = hex.replace('#', '');
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function ConsultationTable({ consultations, onRowClick, onRespond, selectedIds, onToggleSelect, onSelectAll, onDelete }) {
  const headerCheckboxRef = useRef(null);

  const pageIds = consultations.map((c) => c.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds?.has(id));
  const partiallySelected = !allSelected && pageIds.some((id) => selectedIds?.has(id));

  const getPreview = (text) => {
    if (!text) return '';
    const trimmed = String(text).trim();
    return trimmed.length > 34 ? `${trimmed.slice(0, 34)}…` : trimmed;
  };

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = partiallySelected;
    }
  }, [partiallySelected]);

  const formatDate = (date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${month}.${day} ${hours}:${minutes}`;
  };

  const handleRespond = (e, id, check) => {
    e.stopPropagation();
    onRespond(id, check);
  };

  const handleCheckbox = (e, id) => {
    e.stopPropagation();
    onToggleSelect(id);
  };

  const handleDelete = (e, id) => {
    e.stopPropagation();
    onDelete(id);
  };

  const handleSelectAll = (e) => {
    onSelectAll(consultations, e.target.checked);
  };

  return (
    <div className="consultation-table-wrapper">
      <table className="consultation-table">
        <colgroup>
          <col style={{ width: '40px' }} />
          <col style={{ width: '45px' }} />
          <col style={{ width: '100px' }} />
          <col style={{ width: '100px' }} />
          <col style={{ width: '100px' }} />
          <col style={{ width: '160px' }} />
          <col style={{ width: '400px' }} />
          <col style={{ width: '96px' }} />
          <col style={{ width: '140px' }} />
        </colgroup>
        <thead>
          <tr>
            <th className="select-col">
              <input
                type="checkbox"
                ref={headerCheckboxRef}
                checked={allSelected}
                onChange={handleSelectAll}
              />
            </th>
            <th className="number-col">번호</th>
            <th className="type-col">구분</th>
            <th className="name-col">이름</th>
            <th className="company-col">상호</th>
            <th className="contact-col">연락처</th>
            <th className="content-col">내용</th>
            <th className="date-col">날짜/시간</th>
            <th className="action-col">확인/삭제</th>
          </tr>
        </thead>
        <tbody>
          {consultations.map((consultation) => {
            const typeColor = getTypeColor(consultation.type);
            const isUnread = !consultation.check;

            return (
              <tr
                key={consultation.id}
                className={`consultation-row ${isUnread ? 'unread' : 'read'}`}
                onClick={() => onRowClick(consultation)}
              >
                <td className="select-cell select-col" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds?.has(consultation.id)}
                    onChange={(e) => handleCheckbox(e, consultation.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td className="number-cell number-col">{consultation.number}</td>
                <td className="type-cell type-col">
                  <span
                    className="type-tag"
                    style={{
                      color: typeColor,
                      backgroundColor: hexToRgba(typeColor, 0.12),
                      borderColor: hexToRgba(typeColor, 0.28),
                    }}
                  >
                    {consultation.type}
                  </span>
                </td>
                <td className={`name-cell name-col ${isUnread ? 'bold' : ''}`}>
                  {consultation.name}
                </td>
                <td className="company-cell company-col">
                  {consultation.company || '-'}
                </td>
                <td className="contact-cell contact-col">
                  <div className="contact-phone">{consultation.phone}</div>
                  <div className="contact-email">{consultation.email}</div>
                </td>
                <td className="content-cell content-col" title={consultation.message}>
                  {getPreview(consultation.message)}
                </td>
                <td className="date-cell date-col">{formatDate(consultation.createdAt)}</td>
                <td className="action-cell action-col">
                  <div className="action-buttons">
                    <button
                      className={`respond-btn ${isUnread ? 'unread' : 'responded'}`}
                      onClick={(e) => handleRespond(e, consultation.id, consultation.check)}
                      disabled={!isUnread}
                      title={isUnread ? '확인 시 SMS 자동 발송' : '확인 완료 (문자 발송됨)'}
                    >
                      {isUnread ? '확인문자' : '완료'}
                    </button>
                    <button className="delete-btn" onClick={(e) => handleDelete(e, consultation.id)}>
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default ConsultationTable;
