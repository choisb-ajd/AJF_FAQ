const { getSessionFromReq } = require('../../lib/auth');
const { readPerformanceDashboard } = require('../../lib/sheetsRepo');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    const useCache = req.query.force !== '1';
    const { headers, rows } = await readPerformanceDashboard({ useCache });

    // 매니저 이름 칼럼: 헤더에서 "매니저"가 포함된 칼럼을 찾습니다
    const managerColIndex = headers.findIndex(
      (h) => typeof h === 'string' && h.trim().includes('매니저')
    );

    let filteredRows = rows;
    if (session.role !== '관리자' && managerColIndex >= 0) {
      filteredRows = rows.filter(
        (row) => (row[managerColIndex] || '').trim() === session.name.trim()
      );
    }

    return res.status(200).json({
      ok: true,
      headers,
      rows: filteredRows,
      managerColIndex,
    });
  } catch (e) {
    console.error('performance API error:', e);
    return res.status(500).json({ error: '실적 데이터를 불러오지 못했습니다.' });
  }
}
