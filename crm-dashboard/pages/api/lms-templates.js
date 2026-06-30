const { getSessionFromReq } = require('../../lib/auth');
const {
  readTemplatesSheet,
  addTemplateCategory,
  renameTemplateCategory,
  deleteTemplateCategory,
  addTemplateEntry,
  updateTemplateEntry,
  deleteTemplateEntry,
} = require('../../lib/sheetsRepo');

const TEMPLATES_KEY = 'lms-template';

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  if (req.method === 'GET') {
    try {
      const data = await readTemplatesSheet(TEMPLATES_KEY);
      return res.status(200).json({ ok: true, categories: data.categories, entries: data.entries });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || '불러오지 못했습니다.' });
    }
  }

  if (req.method === 'POST') {
    const { action, id, categoryId, title, content, isAdminTemplate } = req.body || {};
    try {
      if (action === 'addCategory') {
        const result = await addTemplateCategory(TEMPLATES_KEY, title);
        return res.status(200).json({ ok: true, ...result });
      }
      if (action === 'renameCategory') {
        if (typeof id !== 'string' || !id) return res.status(400).json({ error: '잘못된 요청입니다.' });
        const result = await renameTemplateCategory(TEMPLATES_KEY, id, title);
        return res.status(200).json({ ok: true, ...result });
      }
      if (action === 'deleteCategory') {
        if (typeof id !== 'string' || !id) return res.status(400).json({ error: '잘못된 요청입니다.' });
        const result = await deleteTemplateCategory(TEMPLATES_KEY, id);
        return res.status(200).json({ ok: true, ...result });
      }
      if (action === 'addEntry') {
        if (typeof categoryId !== 'string' || !categoryId) {
          return res.status(400).json({ error: '잘못된 요청입니다.' });
        }
        const result = await addTemplateEntry(TEMPLATES_KEY, { categoryId, content, isAdminTemplate }, session);
        return res.status(200).json({ ok: true, ...result });
      }
      if (action === 'updateEntry') {
        if (typeof id !== 'string' || !id) {
          return res.status(400).json({ error: '잘못된 요청입니다.' });
        }
        const result = await updateTemplateEntry(TEMPLATES_KEY, id, { content, isAdminTemplate }, session);
        return res.status(200).json({ ok: true, ...result });
      }
      if (action === 'deleteEntry') {
        if (typeof id !== 'string' || !id) {
          return res.status(400).json({ error: '잘못된 요청입니다.' });
        }
        const result = await deleteTemplateEntry(TEMPLATES_KEY, id, session);
        return res.status(200).json({ ok: true, ...result });
      }
      return res.status(400).json({ error: '잘못된 요청입니다.' });
    } catch (e) {
      console.error(e);
      return res.status(400).json({ error: e.message || '저장 중 오류가 발생했습니다.' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
