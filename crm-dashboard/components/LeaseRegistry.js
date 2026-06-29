import { useEffect, useMemo, useState } from 'react';

export default function LeaseRegistry({ isAdmin }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [adding, setAdding] = useState(false);
  const [newCompany, setNewCompany] = useState('');
  const [newBusinessNumber, setNewBusinessNumber] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [editCompany, setEditCompany] = useState('');
  const [editBusinessNumber, setEditBusinessNumber] = useState('');

  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState('');
  const [toast, setToast] = useState('');

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? '' : t)), 2000);
  }

  useEffect(() => {
    let alive = true;
    fetch('/api/lease-registry')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '불러오지 못했습니다.');
        return data;
      })
      .then((data) => {
        if (!alive) return;
        setEntries(data.entries || []);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => (a.company || '').localeCompare(b.company || '', 'ko')),
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const keyword = search.trim();
    if (!keyword) return sortedEntries;
    return sortedEntries.filter(
      (e) => (e.company || '').includes(keyword) || (e.businessNumber || '').includes(keyword)
    );
  }, [sortedEntries, search]);

  function startAdd() {
    setEditingId(null);
    setAdding(true);
    setNewCompany('');
    setNewBusinessNumber('');
    setRowError('');
  }

  function cancelAdd() {
    setAdding(false);
    setRowError('');
  }

  async function submitAdd() {
    const company = newCompany.trim();
    if (!company) {
      setRowError('리스(질권사) 이름을 입력해주세요.');
      return;
    }
    setSaving(true);
    setRowError('');
    try {
      const res = await fetch('/api/lease-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addEntry', company, businessNumber: newBusinessNumber.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '추가하지 못했습니다.');
      setEntries(data.entries);
      setAdding(false);
      setNewCompany('');
      setNewBusinessNumber('');
      showToast('완료 되었습니다.');
    } catch (e) {
      setRowError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(entry) {
    setAdding(false);
    setEditingId(entry.id);
    setEditCompany(entry.company || '');
    setEditBusinessNumber(entry.businessNumber || '');
    setRowError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setRowError('');
  }

  async function saveEdit() {
    const company = editCompany.trim();
    if (!company) {
      setRowError('리스(질권사) 이름을 입력해주세요.');
      return;
    }
    setSaving(true);
    setRowError('');
    try {
      const res = await fetch('/api/lease-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateEntry',
          id: editingId,
          company,
          businessNumber: editBusinessNumber.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장하지 못했습니다.');
      setEntries(data.entries);
      setEditingId(null);
      showToast('수정 되었습니다.');
    } catch (e) {
      setRowError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entry) {
    if (!window.confirm('이 항목을 삭제하시겠습니까?')) return;
    setRowError('');
    try {
      const res = await fetch('/api/lease-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteEntry', id: entry.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '삭제하지 못했습니다.');
      setEntries(data.entries);
      if (editingId === entry.id) setEditingId(null);
      showToast('삭제 되었습니다.');
    } catch (e) {
      setRowError(e.message);
    }
  }

  if (loading) return <div className="loading-state">불러오는 중...</div>;
  if (error && entries.length === 0) return <div className="error-state">{error}</div>;

  return (
    <>
      {toast && <div className="app-toast">{toast}</div>}

      <div className="lease-toolbar">
        <input
          className="lease-search"
          placeholder="리스(질권사) 또는 사업자등록번호 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="btn" onClick={() => setSearch('')}>초기화</button>
        {isAdmin && !adding && (
          <button type="button" className="btn btn-primary lease-add-btn" onClick={startAdd}>+ 리스(질권사) 등록</button>
        )}
      </div>

      <div className="lease-result-count">총 {filteredEntries.length}건</div>

      {rowError && <div className="error-state lms-inline-error">{rowError}</div>}

      <div className="table-wrap">
        <table className="lease-table">
          <thead>
            <tr>
              <th className="lease-col-num">번호</th>
              <th className="lease-col-company">리스(질권사)</th>
              <th className="lease-col-bizno">사업자등록번호</th>
              {isAdmin && <th className="lease-col-actions">관리</th>}
            </tr>
          </thead>
          <tbody>
            {adding && (
              <tr>
                <td className="lease-col-num">-</td>
                <td>
                  <input
                    autoFocus
                    className="lease-edit-input"
                    placeholder="리스(질권사) 이름"
                    value={newCompany}
                    onChange={(e) => setNewCompany(e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="lease-edit-input"
                    placeholder="사업자등록번호"
                    value={newBusinessNumber}
                    onChange={(e) => setNewBusinessNumber(e.target.value)}
                  />
                </td>
                <td className="lease-row-actions">
                  <button type="button" className="btn" onClick={cancelAdd} disabled={saving}>취소</button>
                  <button type="button" className="btn btn-primary" onClick={submitAdd} disabled={saving}>
                    {saving ? '저장 중...' : '추가'}
                  </button>
                </td>
              </tr>
            )}
            {filteredEntries.length === 0 && !adding ? (
              <tr className="empty-row">
                <td colSpan={isAdmin ? 4 : 3}>
                  {search ? '검색 결과가 없습니다.' : '등록된 항목이 없습니다.'}
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry, i) => {
                const isEditing = editingId === entry.id;
                return (
                  <tr key={entry.id}>
                    <td className="lease-col-num">{i + 1}</td>
                    <td>
                      {isEditing ? (
                        <input
                          autoFocus
                          className="lease-edit-input"
                          value={editCompany}
                          onChange={(e) => setEditCompany(e.target.value)}
                        />
                      ) : (
                        entry.company
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          className="lease-edit-input"
                          value={editBusinessNumber}
                          onChange={(e) => setEditBusinessNumber(e.target.value)}
                        />
                      ) : (
                        entry.businessNumber || <span className="notepad-empty">미등록</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="lease-row-actions">
                        {isEditing ? (
                          <>
                            <button type="button" className="btn" onClick={cancelEdit} disabled={saving}>취소</button>
                            <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={saving}>
                              {saving ? '저장 중...' : '저장'}
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn btn-primary" onClick={() => startEdit(entry)}>수정</button>
                            <button type="button" className="btn btn-danger" onClick={() => deleteEntry(entry)}>삭제</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
