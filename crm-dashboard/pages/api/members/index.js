const { getSessionFromReq } = require('../../../lib/auth');
const { getAdminRows } = require('../../../lib/sheetsRepo');
const { ADMIN_ONLY_VISIBLE } = require('../../../lib/sheetSchema');

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const { rows } = await getAdminRows();

    let scoped = rows;
    if (session.role !== '관리자') {
      scoped = rows.filter((r) => (r.values.manager || '').trim() === session.name.trim());
    }

    const result = scoped.map((r) => {
      const v = { ...r.values, rowNumber: r.rowNumber };
      if (session.role !== '관리자') {
        for (const key of ADMIN_ONLY_VISIBLE) delete v[key];
      }
      return v;
    });

    return res.status(200).json({ ok: true, role: session.role, name: session.name, rows: result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '데이터를 불러오지 못했습니다.' });
  }
}
