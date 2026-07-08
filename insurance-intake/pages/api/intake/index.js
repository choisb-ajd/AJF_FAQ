const crypto = require('crypto');
const { getSessionFromReq } = require('../../../lib/auth');
const { readIntakeAdminRows } = require('../../../lib/sheetsRepo');
const { INTAKE_MANAGER_VISIBLE } = require('../../../lib/sheetSchema');

function computeETag(rows) {
  const body = JSON.stringify(rows);
  return '"' + crypto.createHash('md5').update(body).digest('hex') + '"';
}

// 오프라인 매장 보험접수 현황 목록 조회. 관리자는 전체 칼럼(주민번호 포함)을 보고, 매니저는
// 민감정보(주민번호·생년월일·연락처 전체번호 등)를 뺀 매장용 칼럼만 봅니다 — 화면 코드가 아니라
// 서버 응답 단계에서부터 걸러서 매니저 브라우저로는 애초에 전송되지 않게 합니다.
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
    const rows = await readIntakeAdminRows({ useCache: !force });
    const result = rows.map((r) => {
      if (isAdmin) return r;
      const scoped = {};
      for (const key of INTAKE_MANAGER_VISIBLE) scoped[key] = r.values[key];
      return { rowNumber: r.rowNumber, values: scoped };
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
