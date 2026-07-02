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
    const { dateColumns, dataRows } = await readPerformanceDashboard({ useCache });

    const managerRows =
      session.role === '관리자'
        ? dataRows
        : dataRows.filter((r) => r.manager.trim() === session.name.trim());

    return res.status(200).json({
      ok: true,
      dateColumns,
      rows: managerRows,
    });
  } catch (e) {
    console.error('performance API error:', e);
    return res.status(500).json({ error: e.message || '실적 데이터를 불러오지 못했습니다.' });
  }
}
