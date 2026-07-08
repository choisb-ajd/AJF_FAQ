// 구글 시트 칼럼 <-> 내부 필드키 매핑을 한 곳에서 관리합니다.

function columnIndexToLetter(index) {
  let i = index + 1;
  let s = '';
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function letterToColumnIndex(letters) {
  let n = 0;
  for (const ch of String(letters).toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

// 시트에 섞여 저장된 여러 날짜 표기("2025. 6. 20", "2026.01.02", "2025-08-28" 등)를
// 화면에는 항상 "YYYY-MM-DD" 한 가지 형식으로 통일해서 보여줍니다.
function formatDateDisplay(value) {
  const raw = (value || '').toString().trim();
  if (!raw) return '';
  const m = raw.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return raw;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// ── 오프라인 매장 보험접수 현황 ───────────────────────────────────────────────
// 이미 운영중인 두 개의 구글 스프레드시트를 그대로 데이터 원본으로 사용합니다.
//   1) 보험사업부 시트 — "오프매장 전환DB_replit" 탭. 고객 설문 페이지가 여기 A~P열에
//      직접 기록하고, 보험사업부가 Q열 이후에 상담 진행상황을 기록합니다.
//   2) 매장 시트 — "신청인원 현황" 탭. B~L열은 보험사업부 시트를 IMPORTRANGE로 그대로 가져온
//      값(읽기전용)이고, M~O열(고객 선물 지급일자·키트 불출인원·특이사항)은 매장 직원이 직접
//      입력하며, 이 값이 다시 IMPORTRANGE로 보험사업부 시트 AG~AI열에 반영됩니다.
// 두 시트 모두 IMPORTRANGE 수식이 걸린 칼럼이 있어서, 그 칼럼에 그대로 값을 쓰면(values.update)
// 수식이 깨져버립니다. 그래서 각 칼럼을 "survey"(설문 입력값, 읽기전용) / "admin"(보험사업부가 직접
// 입력하는 값, 관리자만 수정 가능) / "derived"(같은 시트 안의 수식, 항상 읽기전용) /
// "storeMirror"(매장 시트 값을 IMPORTRANGE로 가져온 것, 보험사업부 시트 쪽은 읽기전용이며 실제
// 수정은 매장 시트에 직접 해야 함) 네 가지로 분류해 씁니다.
const INTAKE_ADMIN_FIELDS = [
  { key: 'timestamp', label: '일시', col: 'A', kind: 'survey' },
  { key: 'name', label: '이름', col: 'B', kind: 'survey' },
  { key: 'phone', label: '연락처', col: 'C', kind: 'survey' },
  { key: 'residentNumber', label: '주민번호', col: 'D', kind: 'survey' },
  { key: 'birthDate', label: '생년월일', col: 'E', kind: 'survey' },
  { key: 'immediateApply', label: '즉시신청', col: 'F', kind: 'survey' },
  { key: 'immediateApplyLabel', label: '즉시신청여부', col: 'G', kind: 'survey' },
  { key: 'secondChoiceDate', label: '2순위일자', col: 'H', kind: 'survey' },
  { key: 'secondChoiceTime', label: '2순위시간', col: 'I', kind: 'survey' },
  { key: 'region', label: '권역', col: 'J', kind: 'survey' },
  { key: 'branch', label: '지점', col: 'K', kind: 'survey' },
  { key: 'referrer', label: '추천인', col: 'L', kind: 'survey' },
  { key: 'drivingInterest', label: '운전여부', col: 'M', kind: 'survey' },
  { key: 'ownCar', label: '자차보유', col: 'N', kind: 'survey' },
  { key: 'surgeryHistory', label: '17년도 이후 수술/입원여부', col: 'O', kind: 'survey' },
  { key: 'giftChoice', label: '선택 선물', col: 'P', kind: 'survey' },
  { key: 'dupCheckDate', label: '중복보장점검완료일', col: 'Q', kind: 'admin' },
  { key: 'kitGuideStatus', label: '키트수령안내여부', col: 'R', kind: 'admin' },
  { key: 'counselorName', label: '담당(파트너스 매장 현장 DB)', col: 'S', kind: 'admin' },
  { key: 'consultMethod', label: '상담방식', col: 'T', kind: 'admin' },
  { key: 'consultNote', label: '상담결과', col: 'U', kind: 'admin' },
  { key: 'consultStatus', label: '상담상태', col: 'V', kind: 'admin' },
  { key: 'phoneLast4', label: '연락처 뒤 4자리', col: 'W', kind: 'derived' },
  { key: 'rejectReason', label: '거절 사유분류', col: 'X', kind: 'admin' },
  { key: 'insuranceJoined', label: '보험가입여부', col: 'Y', kind: 'admin' },
  { key: 'insuranceJoinDate', label: '보험가입일자', col: 'Z', kind: 'admin' },
  { key: 'premium', label: '보험료', col: 'AA', kind: 'admin' },
  { key: 'cancelDate', label: '보험가입후 취소일자', col: 'AB', kind: 'admin' },
  { key: 'applyDate', label: '신청일', col: 'AC', kind: 'derived' },
  { key: 'dupCheckMonth', label: '중복보장점검완료월', col: 'AD', kind: 'derived' },
  { key: 'dupCheckDone', label: '중복보장점검 완료여부', col: 'AE', kind: 'derived' },
  { key: 'insuranceJoinFlag', label: '보험가입', col: 'AF', kind: 'derived' },
  { key: 'giftGivenDate', label: '고객 선물 지급일자', col: 'AG', kind: 'storeMirror' },
  { key: 'kitIssuedBy', label: '오프매장-키트불출인원', col: 'AH', kind: 'storeMirror' },
  { key: 'storeNote', label: '오프매장-특이사항', col: 'AI', kind: 'storeMirror' },
  { key: 'ageGroup', label: '연령대', col: 'AJ', kind: 'derived' },
  { key: 'before0610', label: "26.06.10 이전 여부", col: 'AK', kind: 'derived' },
  { key: 'conversionUnitPrice', label: '전환단가', col: 'AL', kind: 'derived' },
  { key: 'applyMonth', label: '신청월', col: 'AM', kind: 'derived' },
  { key: 'contractUnitPrice', label: '체결단가', col: 'AN', kind: 'derived' },
  { key: 'contractMonth', label: '체결월', col: 'AO', kind: 'derived' },
  { key: 'incentiveExcluded', label: '전환 인센티브 미적용', col: 'AP', kind: 'admin' },
  { key: 'contacted', label: '컨택여부', col: 'AQ', kind: 'derived' },
];

// 보험사업부(관리자)가 화면에서 직접 입력/수정하는 항목. 이 목록에 없는 칼럼은
// (survey/derived/storeMirror 전부) 시트에 수식이 걸려 있거나 설문 원본이라 절대 덮어쓰지 않습니다.
const INTAKE_ADMIN_EDITABLE = INTAKE_ADMIN_FIELDS.filter((f) => f.kind === 'admin').map((f) => f.key);

// 매니저(매장) 화면에 보여줄 항목 — 주민번호·생년월일·연락처 전체번호 등 민감정보는 제외합니다.
const INTAKE_MANAGER_VISIBLE = [
  'timestamp', 'name', 'phoneLast4', 'branch', 'referrer', 'giftChoice',
  'dupCheckDate', 'kitGuideStatus', 'incentiveExcluded', 'insuranceJoinDate', 'before0610',
  'giftGivenDate', 'kitIssuedBy', 'storeNote', 'consultStatus',
];

// 관리자 표에 기본으로 보여줄 요약 칼럼 (상세는 모달에서 전체 확인)
const INTAKE_DISPLAY_COLUMNS = [
  'timestamp', 'name', 'phoneLast4', 'branch', 'region', 'referrer', 'immediateApply',
  'giftChoice', 'consultStatus', 'dupCheckDate', 'kitGuideStatus', 'insuranceJoined', 'giftGivenDate',
];

// 매니저(매장) 표에 기본으로 보여줄 요약 칼럼 (나머지 INTAKE_MANAGER_VISIBLE 항목은 상세 모달에서 확인)
const INTAKE_MANAGER_DISPLAY_COLUMNS = [
  'timestamp', 'name', 'phoneLast4', 'branch', 'giftChoice', 'dupCheckDate', 'kitGuideStatus', 'giftGivenDate',
];

// "신청인원 현황" 탭(매장 시트): 헤더는 2행, 데이터는 3행부터. 매장 직원이 직접 입력하는 칼럼(M~O)만
// 이 앱에서 씁니다. B~L열은 보험사업부 시트를 IMPORTRANGE로 그대로 가져온 값이라 절대 쓰지 않습니다.
// timestamp(B열, 보험사업부 시트 A열과 동일한 값)로 두 시트의 같은 신청 건을 짝지어 찾습니다.
const INTAKE_STORE_SHEET = {
  title: '신청인원 현황',
  headerRow: 2,
  dataStartRow: 3,
  timestampCol: 'B',
  nameCol: 'C',
  editable: [
    { key: 'giftGivenDate', label: '고객 선물 지급일자', col: 'M' },
    { key: 'kitIssuedBy', label: '키트 불출인원', col: 'N' },
    { key: 'storeNote', label: '특이사항', col: 'O' },
  ],
};
const INTAKE_STORE_EDITABLE = INTAKE_STORE_SHEET.editable.map((f) => f.key);

module.exports = {
  columnIndexToLetter,
  letterToColumnIndex,
  formatDateDisplay,
  INTAKE_ADMIN_FIELDS,
  INTAKE_ADMIN_EDITABLE,
  INTAKE_MANAGER_VISIBLE,
  INTAKE_DISPLAY_COLUMNS,
  INTAKE_MANAGER_DISPLAY_COLUMNS,
  INTAKE_STORE_SHEET,
  INTAKE_STORE_EDITABLE,
};
