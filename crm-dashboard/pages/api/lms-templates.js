const { getSessionFromReq } = require('../../lib/auth');
const { readTemplatesSheet, addTemplateEntry, updateTemplateEntry } = require('../../lib/sheetsRepo');

const TEMPLATES_KEY = 'lms-template';

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  if (req.method === 'GET') {
    try {
      const data = await readTemplatesSheet(TEMPLATES_KEY);
      return res.status(200).json({ ok: true, templates: data.templates });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || '불러오지 못했습니다.' });
    }
  }

  if (req.method === 'POST') {
    const { action, id, title, content } = req.body || {};
    try {
      if (action === 'add') {
        const templates = await addTemplateEntry(TEMPLATES_KEY, title);
        return res.status(200).json({ ok: true, templates });
      }
      if (action === 'update') {
        if (typeof id !== 'string' || !id) {
          return res.status(400).json({ error: '잘못된 요청입니다.' });
        }
        const templates = await updateTemplateEntry(TEMPLATES_KEY, id, { content });
        return res.status(200).json({ ok: true, templates });
      }
      return res.status(400).json({ error: '잘못된 요청입니다.' });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || '저장 중 오류가 발생했습니다.' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
