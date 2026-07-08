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
    const { rows, etag: cachedEtag } = await getAdminRows({ useCache: !force });

    res.setHeader('Cache-Control', 'no-cache');

    if (session.role === '관리자') {
      // 관리자: ETag는 캐시 갱신 시점에 이미 계산됨 → 요청마다 재계산 없음
      if (req.headers['if-none-match'] === cachedEtag) {
        return res.status(304).end();
      }
      res.setHeader('ETag', cachedEtag);
      const result = rows.map((r) => ({ ...r.values, rowNumber: r.rowNumber }));
      return res.status(200).json({ ok: true, role: session.role, name: session.name, rows: result });
    }

    // 매니저: 본인 담당 행만 필터링 후 ETag 계산 (데이터셋이 사용자마다 달라서 공유 불가)
    const scoped = rows.filter((r) => (r.values.manager || '').trim() === session.name.trim());
    const result = scoped.map((r) => {
      const v = { ...r.values, rowNumber: r.rowNumber };
      for (const key of ADMIN_ONLY_VISIBLE) delete v[key];
      return v;
    });
    const etag = computeETag(result);
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.setHeader('ETag', etag);
    return res.status(200).json({ ok: true, role: session.role, name: session.name, rows: result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '데이터를 불러오지 못했습니다.' });
  }
}
