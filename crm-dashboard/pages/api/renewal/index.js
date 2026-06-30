const crypto = require('crypto');
const { getSessionFromReq } = require('../../../lib/auth');
const { readRenewalRows } = require('../../../lib/sheetsRepo');

function computeETag(rows) {
  const body = JSON.stringify(rows);
  return '"' + crypto.createHash('md5').update(body).digest('hex') + '"';
}

// 갱신배정 탭 목록 조회. 매니저는 본인이 담당하는 행만 보이고, 배정순번(관리자 전용 항목)은
// 응답에서 아예 제외해 화면 코드가 아니라 서버 단에서부터 권한을 보장합니다.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const isAdmin = session.role === '관리자';

  try {
    const force = req.query.force === '1';
    const { rows } = await readRenewalRows({ useCache: !force });
    const scoped = isAdmin ? rows : rows.filter((r) => (r.values.manager || '').trim() === session.name.trim());
    const result = scoped.map((r) => {
      if (isAdmin) return r;
      const { assignOrder, ...rest } = r.values;
      return { rowNumber: r.rowNumber, values: rest };
    });

    const etag = computeETag(result);
    if (!force && req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).json({ ok: true, rows: result, isAdmin });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || '불러오지 못했습니다.' });
  }
}
