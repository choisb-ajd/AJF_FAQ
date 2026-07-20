const { getSessionFromReq } = require('../../../lib/auth');
const { getAdminRows } = require('../../../lib/sheetsRepo');

// GET /api/members/search?q=검색어
// 이름 또는 전화번호로 전체 딜러를 검색합니다. 매니저도 타 담당 딜러 조회 가능하며,
// 민감 정보(adminNote 등) 없이 이름·연락처·담당매니저·배분일자만 반환합니다.
export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const q = (req.query.q || '').trim();
  if (!q) return res.status(200).json({ rows: [] });

  try {
    const { rows } = await getAdminRows({ useCache: true });
    const qLower = q.toLowerCase();
    const qPhone = q.replace(/\D/g, '');

    const matched = rows
      .filter((r) => {
        const rName = (r.values.name || '').toLowerCase();
        const rPhone = (r.values.phone || '').replace(/\D/g, '');
        return rName.includes(qLower) || (qPhone.length >= 3 && rPhone.includes(qPhone));
      })
      .map((r) => ({
        name: r.values.name || '',
        phone: r.values.phone || '',
        manager: r.values.manager || '',
        assignedDate: r.values.assignedDate || '',
      }))
      .slice(0, 30);

    return res.status(200).json({ rows: matched });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '검색 중 오류가 발생했습니다.' });
  }
}
