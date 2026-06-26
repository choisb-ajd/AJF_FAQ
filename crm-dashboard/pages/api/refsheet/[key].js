const { getSessionFromReq } = require('../../../lib/auth');
const { readRefSheetGrid, updateRefSheetCell } = require('../../../lib/sheetsRepo');
const { REF_SHEETS } = require('../../../lib/sheetSchema');

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const { key } = req.query;
  if (!REF_SHEETS.some((s) => s.key === key)) {
    return res.status(404).json({ error: '존재하지 않는 시트입니다.' });
  }

  if (req.method === 'GET') {
    try {
      const grid = await readRefSheetGrid(key);
      return res.status(200).json({ ok: true, ...grid });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || '시트를 불러오지 못했습니다.' });
    }
  }

  if (req.method === 'POST') {
    if (session.role !== '관리자') {
      return res.status(403).json({ error: '관리자만 수정할 수 있습니다.' });
    }
    const { rowIndex, colIndex, value } = req.body || {};
    if (!Number.isInteger(rowIndex) || !Number.isInteger(colIndex) || rowIndex < 0 || colIndex < 0) {
      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }
    try {
      await updateRefSheetCell(key, rowIndex, colIndex, value == null ? '' : String(value));
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || '저장 중 오류가 발생했습니다.' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
