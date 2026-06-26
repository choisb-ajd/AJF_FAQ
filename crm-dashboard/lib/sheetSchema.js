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
  { key: 'registeredAt', headers: ['등록일자'] },
];

// 화면에 보여줄 컬럼 순서/라벨 (테이블 렌더링용)
const DISPLAY_COLUMNS = [
  { key: 'name', label: '이름' },
  { key: 'phone', label: '연락처' },
  { key: 'manager', label: '담당매니저' },
  { key: 'group', label: '그룹' },
  { key: 'brand', label: '브랜드' },
  { key: 'branch', label: '지점/대리점' },
  { key: 'contacted', label: '컨택여부' },
  { key: 'firstContactDate', label: '최초컨택일자' },
  { key: 'reContactDate', label: '재컨택일자' },
  { key: 'smsSent', label: '문자여부' },
  { key: 'contactSentiment', label: '호의도' },
  { key: 'contactHistory', label: '컨택 히스토리' },
  { key: 'appJoinDate', label: 'App가입일자' },
  { key: 'totalContracts', label: '누적계약' },
  { key: 'last60dContracts', label: '직전60일' },
  { key: 'registeredAt', label: '등록일자' },
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

// 딜러 상세/추가 모달에서 항상 보이는 기본 정보 항목 (관리자·매니저 공통 순서)
const MODAL_PRIMARY_FIELDS = ['group', 'brand', 'branch', 'name', 'phone', 'contacted'];

// 모달에서 "접어두기"로 기본 숨김 처리되는 항목 (관리자·매니저 공통)
const MODAL_COMMON_COLLAPSIBLE = [
  'firstContactDate',
  'reContactDate',
  'smsSent',
  'contactSentiment',
  'preRegistered',
  'assignedDate',
  'priorityDealer',
  'highEfficiency',
  'highEfficiencyScore',
];

// 접어두기 영역 중 관리자에게만 추가로 보이는 항목
const MODAL_ADMIN_COLLAPSIBLE_EXTRA = ['manager', 'adminNote', 'lastModifiedBy'];

// 자동으로만 채워지는 값이라 상세/추가 모달에는 노출하지 않고 표(칼럼)에만 보여주는 항목
const MODAL_EXCLUDED_FIELDS = ['appJoinDate', 'totalContracts', 'last60dContracts', 'last1yTop10', 'wideInsta', 'region'];

// 값이 바뀌면 컨택 히스토리에 "상담 변경이력"으로 자동 기록할 상태성 항목 (필드키 -> 표시 라벨)
const CHANGE_LOG_FIELDS = {
  contacted: '컨택여부',
  contactSentiment: '컨택 호의도',
  preRegistered: '사전예약여부',
  smsSent: '문자여부',
  priorityDealer: '우선컨택 딜러여부',
  highEfficiency: '고효율딜러여부',
};

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

// 딜러가 등록된 시각을 "YYYY-MM-DD HH:mm:ss" (한국시간) 형태로 만듭니다.
// 문자열로 그대로 정렬해도 시간 순서가 맞도록 고정폭으로 만든 형식입니다.
function formatRegisteredAt(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
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

// 컨택 히스토리는 한 셀(문자열) 안에 줄 단위로 "메모"와 "상담 변경이력"을 함께 저장합니다.
// 형식: "NOTE\t시각\t작성자\t내용" / "CHANGE\t시각\t작성자\t항목명\t이전값\t이후값"
// 형식에 맞지 않는 줄(과거에 자유롭게 입력해둔 텍스트)은 작성자/시각 없는 메모로 취급합니다.
function appendContactHistoryNote(existing, { author, text, timestamp }) {
  const ts = timestamp || formatRegisteredAt();
  const safeText = (text || '').toString().replace(/[\n\r\t]+/g, ' ').trim();
  const line = `NOTE\t${ts}\t${author || ''}\t${safeText}`;
  const base = (existing || '').toString();
  return base ? `${base}\n${line}` : line;
}

function appendContactHistoryChange(existing, { author, field, oldValue, newValue, timestamp }) {
  const ts = timestamp || formatRegisteredAt();
  const line = `CHANGE\t${ts}\t${author || ''}\t${field}\t${(oldValue || '').toString()}\t${(newValue || '').toString()}`;
  const base = (existing || '').toString();
  return base ? `${base}\n${line}` : line;
}

function parseContactHistory(raw) {
  const lines = (raw || '').toString().split('\n').map((l) => l.trim()).filter(Boolean);
  const notes = [];
  const changes = [];
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts[0] === 'NOTE' && parts.length >= 4) {
      notes.push({ timestamp: parts[1], author: parts[2], text: parts.slice(3).join('\t') });
    } else if (parts[0] === 'CHANGE' && parts.length >= 6) {
      changes.push({ timestamp: parts[1], author: parts[2], field: parts[3], oldValue: parts[4], newValue: parts[5] });
    } else {
      notes.push({ timestamp: '', author: '', text: line });
    }
  }
  return { notes: notes.reverse(), changes: changes.reverse() };
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
  MODAL_PRIMARY_FIELDS,
  MODAL_COMMON_COLLAPSIBLE,
  MODAL_ADMIN_COLLAPSIBLE_EXTRA,
  MODAL_EXCLUDED_FIELDS,
  CHANGE_LOG_FIELDS,
  buildColumnMap,
  rowArrayToValues,
  normalizePhone,
  columnIndexToLetter,
  formatRegisteredAt,
  formatDateDisplay,
  appendContactHistoryNote,
  appendContactHistoryChange,
  parseContactHistory,
};
