const crypto = require('crypto');
const { getSessionFromReq } = require('../../../lib/auth');
const { getAdminRows } = require('../../../lib/sheetsRepo');
const { ADMIN_ONLY_VISIBLE } = require('../../../lib/sheetSchema');

function computeETag(rows) {
  const body = JSON.stringify(rows);
  return '"' + crypto.createHash('md5').update(body).digest('hex') + '"';
}

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const force = req.query.force === '1';
    const { rows } = await getAdminRows({ useCache: !force });

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

    const etag = computeETag(result);

    // 클라이언트가 보낸 ETag와 일치하면 데이터 변경 없음 → 빈 응답으로 전송 절약
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).json({ ok: true, role: session.role, name: session.name, rows: result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '데이터를 불러오지 못했습니다.' });
  }
}
