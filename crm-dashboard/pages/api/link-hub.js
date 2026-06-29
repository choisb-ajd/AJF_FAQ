const { getSessionFromReq } = require('../../lib/auth');
const {
  readLinkHub,
  addInternalLink,
  updateInternalLink,
  deleteInternalLink,
  addInsurerLink,
  updateInsurerLink,
  deleteInsurerLink,
} = require('../../lib/sheetsRepo');

const LINK_HUB_KEY = 'cm-tm';

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  if (req.method === 'GET') {
    try {
      const data = await readLinkHub(LINK_HUB_KEY);
      return res.status(200).json({ ok: true, internalLinks: data.internalLinks, insurerLinks: data.insurerLinks });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || '불러오지 못했습니다.' });
    }
  }

  if (req.method === 'POST') {
    const { action, id, category, detail, insurer, tmNumber, cmUrlPc, cmUrlMobile, note, remark } = req.body || {};
    try {
      if (action === 'addInternalLink') {
        const result = await addInternalLink(LINK_HUB_KEY, { category, detail }, session);
        return res.status(200).json({ ok: true, ...result });
      }
      if (action === 'updateInternalLink') {
        if (typeof id !== 'string' || !id) return res.status(400).json({ error: '잘못된 요청입니다.' });
        const result = await updateInternalLink(LINK_HUB_KEY, id, { category, detail }, session);
        return res.status(200).json({ ok: true, ...result });
      }
      if (action === 'deleteInternalLink') {
        if (typeof id !== 'string' || !id) return res.status(400).json({ error: '잘못된 요청입니다.' });
        const result = await deleteInternalLink(LINK_HUB_KEY, id, session);
        return res.status(200).json({ ok: true, ...result });
      }
      if (action === 'addInsurerLink') {
        const result = await addInsurerLink(LINK_HUB_KEY, { insurer, tmNumber, cmUrlPc, cmUrlMobile, note, remark }, session);
        return res.status(200).json({ ok: true, ...result });
      }
      if (action === 'updateInsurerLink') {
        if (typeof id !== 'string' || !id) return res.status(400).json({ error: '잘못된 요청입니다.' });
        const result = await updateInsurerLink(LINK_HUB_KEY, id, { insurer, tmNumber, cmUrlPc, cmUrlMobile, note, remark }, session);
        return res.status(200).json({ ok: true, ...result });
      }
      if (action === 'deleteInsurerLink') {
        if (typeof id !== 'string' || !id) return res.status(400).json({ error: '잘못된 요청입니다.' });
        const result = await deleteInsurerLink(LINK_HUB_KEY, id, session);
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
