const { getSessionFromReq } = require('../../../lib/auth');
const { getAdminRows } = require('../../../lib/sheetsRepo');

// GET /api/members/search?name=이름&phone=숫자만
// 이름(부분일치) 및/또는 전화번호(부분일치)로 전체 딜러를 AND 조건 검색합니다.
// 민감 정보 없이 이름·연락처·담당매니저·배분일자만 반환합니다.
export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const namePart = (req.query.name || '').trim().toLowerCase();
  const phonePart = (req.query.phone || '').replace(/\D/g, '');

  if (!namePart && !phonePart) return res.status(200).json({ rows: [] });

  try {
    const { rows } = await getAdminRows({ useCache: true });

    const matched = rows
      .filter((r) => {
        const rName = (r.values.name || '').toLowerCase();
        const rPhone = (r.values.phone || '').replace(/\D/g, '');
        const nameOk = !namePart || rName.includes(namePart);
        const phoneOk = !phonePart || rPhone.includes(phonePart);
        return nameOk && phoneOk;
      })
      .map((r) => ({
        name: r.values.name || '',
        phone: r.values.phone || '',
        manager: r.values.manager || '',
        assignedDate: r.values.assignedDate || '',
      }))
      .slice(0, 50);

    return res.status(200).json({ rows: matched });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '검색 중 오류가 발생했습니다.' });
  }
}
