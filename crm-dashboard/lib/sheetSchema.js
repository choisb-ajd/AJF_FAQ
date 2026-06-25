// 구글 시트의 한글 컬럼명 <-> 내부 필드키 매핑을 한 곳에서 관리합니다.
// 관리자용 시트와 매니저 개별 시트는 헤더 문구가 살짝 다른 경우가 있어(예: "컨택 히스토리(매니저)" vs "컨택 히스토리"),
// 필드마다 가능한 헤더 문구를 여러 개(aliases) 등록해두고 실제 헤더 행을 읽을 때 매칭합니다.

const FIELDS = [
  { key: 'managerSheetLink', headers: ['매니저 시트 바로가기'] },
  { key: 'seq', headers: ['seq'] },
  { key: 'group', headers: ['그룹'] },
  { key: 'brand', headers: ['브랜드'] },
  { key: 'wideInsta', headers: ['광역/인스타'] },
  { key: 'region', headers: ['권역'] },
  { key: 'name', headers: ['이름'] },
  { key: 'phone', headers: ['연락처'] },
  { key: 'branch', headers: ['지점/대리점 명'] },
  { key: 'manager', headers: ['담당매니저'] },
  { key: 'assignedDate', headers: ['배분일자'] },
  { key: 'priorityDealer', headers: ['우선컨택 딜러여부'] },
  { key: 'highEfficiency', headers: ['고효율딜러여부'] },
  { key: 'highEfficiencyScore', headers: ['고효율딜러수치'] },
  { key: 'contacted', headers: ['컨택여부'] },
  { key: 'firstContactDate', headers: ['최초컨택일자'] },
  { key: 'reContactDate', headers: ['재컨택일자'] },
  { key: 'smsSent', headers: ['문자여부'] },
  { key: 'contactSentiment', headers: ['컨택 호의도'] },
  { key: 'contactHistory', headers: ['컨택 히스토리(매니저)', '컨택 히스토리'] },
  { key: 'preRegistered', headers: ['사전예약여부'] },
  { key: 'appJoinDate', headers: ['App가입일자'] },
  { key: 'totalContracts', headers: ['누적 계약체결건수'] },
  { key: 'last60dContracts', headers: ['직전 60일 계약체결건수'] },
  { key: 'last1yTop10', headers: ['직전 1년 본인 10% 횟수'] },
  { key: 'adminNote', headers: ['관리자 특이사항'] },
  { key: 'lastModifiedBy', headers: ['수정자'] },
];

// 화면에 보여줄 컬럼 순서/라벨 (테이블 렌더링용)
const DISPLAY_COLUMNS = [
  { key: 'name', label: '이름' },
  { key: 'phone', label: '연락처' },
  { key: 'manager', label: '담당매니저' },
  { key: 'group', label: '그룹' },
  { key: 'brand', label: '브랜드' },
  { key: 'branch', label: '지점/대리점' },
  { key: 'region', label: '권역' },
  { key: 'contacted', label: '컨택여부' },
  { key: 'firstContactDate', label: '최초컨택일자' },
  { key: 'reContactDate', label: '재컨택일자' },
  { key: 'smsSent', label: '문자여부' },
  { key: 'contactSentiment', label: '호의도' },
  { key: 'contactHistory', label: '컨택 히스토리' },
  { key: 'preRegistered', label: '사전예약' },
  { key: 'totalContracts', label: '누적계약' },
  { key: 'last60dContracts', label: '직전60일' },
  { key: 'adminNote', label: '관리자 특이사항', adminOnly: true },
  { key: 'lastModifiedBy', label: '수정자', adminOnly: true },
];

// 매니저 권한으로 수정할 수 있는 필드
const MANAGER_EDITABLE = [
  'contacted',
  'firstContactDate',
  'reContactDate',
  'smsSent',
  'contactSentiment',
  'contactHistory',
  'preRegistered',
];

// 관리자 권한에서만 추가로 수정 가능한 필드 (매니저 수정 가능 필드 + 아래 항목)
const ADMIN_ONLY_EDITABLE = [
  'group',
  'brand',
  'wideInsta',
  'region',
  'branch',
  'manager',
  'assignedDate',
  'priorityDealer',
  'highEfficiency',
  'highEfficiencyScore',
  'appJoinDate',
  'totalContracts',
  'last60dContracts',
  'last1yTop10',
  'adminNote',
];

// 매니저 화면에서 완전히 숨길 필드 (관리자만 보임)
const ADMIN_ONLY_VISIBLE = ['adminNote', 'managerSheetLink', 'lastModifiedBy'];

function buildColumnMap(headerRow) {
  const map = {};
  (headerRow || []).forEach((cell, idx) => {
    const text = (cell || '').toString().trim();
    if (!text) return;
    const field = FIELDS.find((f) => f.headers.includes(text));
    if (field && map[field.key] === undefined) map[field.key] = idx;
  });
  return map;
}

function rowArrayToValues(rowArray, columnMap) {
  const values = {};
  for (const key of Object.keys(columnMap)) {
    values[key] = (rowArray[columnMap[key]] || '').toString();
  }
  return values;
}

function normalizePhone(value) {
  return (value || '').toString().replace(/\D/g, '');
}

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

module.exports = {
  FIELDS,
  DISPLAY_COLUMNS,
  MANAGER_EDITABLE,
  ADMIN_ONLY_EDITABLE,
  ADMIN_ONLY_VISIBLE,
  buildColumnMap,
  rowArrayToValues,
  normalizePhone,
  columnIndexToLetter,
};
