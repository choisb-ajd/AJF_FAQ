const { getSessionFromReq } = require('../../lib/auth');
const { readNotepadSheet, saveNotepadSheet } = require('../../lib/sheetsRepo');

const FAQ_KEY = 'dealer-faq';

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  if (req.method === 'GET') {
    try {
      const data = await readNotepadSheet(FAQ_KEY);
      return res.status(200).json({ ok: true, html: data.html, migrated: data.migrated });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || '불러오지 못했습니다.' });
    }
  }

  if (req.method === 'POST') {
    if (session.role !== '관리자') {
      return res.status(403).json({ error: '관리자만 수정할 수 있습니다.' });
    }
    const { html } = req.body || {};
    if (typeof html !== 'string') {
      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }
    try {
      const result = await saveNotepadSheet(FAQ_KEY, html);
      return res.status(200).json({ ok: true, html: result.html });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || '저장 중 오류가 발생했습니다.' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
