import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import cookie from 'cookie';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, LabelList,
} from 'recharts';
import { verifySession, COOKIE_NAME } from '../lib/auth';
import { REF_SHEETS } from '../lib/sheetSchema';
import ChangePasswordModal from '../components/ChangePasswordModal';
import Announcement from '../components/Announcement';
import FaqWidget from '../components/FaqWidget';

export async function getServerSideProps({ req }) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const session = cookies[COOKIE_NAME] ? verifySession(cookies[COOKIE_NAME]) : null;
  if (!session) return { redirect: { destination: '/login', permanent: false } };
  if (session.role === '관리자') return { redirect: { destination: '/dashboard', permanent: false } };
  return { props: { role: session.role, name: session.name } };
}

// ─── 색상 (검증된 참조 팔레트 슬롯 1-4) ────────────────────────────────────
const METRIC_COLORS = {
  'DB배정수':   '#2a78d6', // slot 1 — blue
  '최초컨택수': '#1baf7a', // slot 2 — aqua  (contrast WARN → 라벨 필수)
  'App가입':    '#eda100', // slot 3 — yellow (contrast WARN → 라벨 필수)
  '채결건수':   '#008300', // slot 4 — green
};
const CHART_METRICS = ['DB배정수', '최초컨택수', 'App가입', '채결건수'];

// ─── 숫자 파싱 ────────────────────────────────────────────────────────────────
function parseNum(str) {
  if (!str || str === '-') return 0;
  return Number(String(str).replace(/,/g, '')) || 0;
}

function fmtNum(n) {
  if (n === 0) return '-';
  return n.toLocaleString('ko-KR');
}

// ─── 차트 데이터 빌드 ─────────────────────────────────────────────────────────
function buildChartData(rows, dateColumns, viewMode) {
  let activeCols;
  const monthlyCols = dateColumns.filter((dc) => dc.isMonthlyAgg);
  if (viewMode === 'monthly') {
    activeCols = monthlyCols.slice(-3);
  } else if (viewMode === 'weekly') {
    const top3Months = new Set(monthlyCols.slice(-3).map((dc) => dc.month));
    activeCols = dateColumns.filter((dc) => dc.isWeeklyAgg && top3Months.has(dc.month));
  } else {
    const daily = dateColumns.filter((dc) => dc.isDaily);
    const latestMonth = daily.length ? daily[daily.length - 1].month : '';
    activeCols = latestMonth ? daily.filter((dc) => dc.month === latestMonth) : daily.slice(-31);
  }
  if (!activeCols.length) return [];

  return activeCols.map((dc) => {
    const globalIdx = dateColumns.indexOf(dc);
    const entry = {
      period:
        viewMode === 'monthly' ? dc.month :
        viewMode === 'weekly'  ? dc.week  : dc.day,
    };
    for (const metric of CHART_METRICS) {
      const row = rows.find((r) => r.metric === metric);
      entry[metric] = row ? parseNum(row.dateValues[globalIdx]) : 0;
    }
    return entry;
  });
}

// ─── 소계 행에서 요약 카드 데이터 추출 ───────────────────────────────────────
function getSummaryRow(rows) {
  return rows.find((r) => r.group === '소계') || rows[rows.length - 1] || null;
}

// ─── 테이블 칼럼 계산 ─────────────────────────────────────────────────────────
function getTableCols(dateColumns, viewMode) {
  const monthlyCols = dateColumns.filter((dc) => dc.isMonthlyAgg);
  if (viewMode === 'monthly') return monthlyCols.slice(-3);
  if (viewMode === 'weekly') {
    const top3Months = new Set(monthlyCols.slice(-3).map((dc) => dc.month));
    return dateColumns.filter((dc) => dc.isWeeklyAgg && top3Months.has(dc.month));
  }
  const daily = dateColumns.filter((dc) => dc.isDaily);
  const latestMonth = daily.length ? daily[daily.length - 1].month : '';
  return latestMonth ? daily.filter((dc) => dc.month === latestMonth) : daily.slice(-31);
}

// ─── 전월 합계 칼럼 (M-1 월집계) ─────────────────────────────────────────────
function getPrevMonthCol(dateColumns) {
  const monthlyCols = dateColumns.filter((dc) => dc.isMonthlyAgg);
  return monthlyCols.length >= 2 ? monthlyCols[monthlyCols.length - 2] : null;
}

// ─── 커스텀 툴팁 ─────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#fff', border: '1px solid #e1e0d9',
      borderRadius: 6, padding: '10px 14px', fontSize: 13,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: '#0b0b0b' }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: p.fill }} />
          <span style={{ color: '#52514e' }}>{p.dataKey}</span>
          <span style={{ fontWeight: 600, marginLeft: 'auto', paddingLeft: 12, color: '#0b0b0b' }}>
            {p.value === 0 ? '-' : p.value.toLocaleString('ko-KR')}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function PerformancePage({ role, name }) {
  const [rawData, setRawData]             = useState(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');
  const [viewMode, setViewMode]           = useState('weekly'); // monthly | weekly | daily
  const [changingPassword, setChangingPassword] = useState(false);

  async function fetchData(force = false) {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(`/api/performance${force ? '?force=1' : ''}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '불러오지 못했습니다.');
      setRawData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchData(); }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const { rows, dateColumns } = rawData || { rows: [], dateColumns: [] };
  const summary      = useMemo(() => getSummaryRow(rows), [rows]);
  const chartData    = useMemo(() => buildChartData(rows, dateColumns, viewMode), [rows, dateColumns, viewMode]);
  const tableCols    = useMemo(() => getTableCols(dateColumns, viewMode), [dateColumns, viewMode]);
  const prevMonthCol = useMemo(() => getPrevMonthCol(dateColumns), [dateColumns]);

  return (
    <div className="app-shell">
      <FaqWidget isAdmin={false} />

      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">My Dealer</span>
          <span className="topbar-badge">{role}</span>
          <nav className="topbar-nav">
            <Link className="topbar-nav-link" href="/dashboard">회원관리</Link>
            {REF_SHEETS.filter((s) => !s.hiddenFromNav).map((s) => (
              <Link key={s.key} className="topbar-nav-link" href={`/sheet/${s.key}`}>{s.label}</Link>
            ))}
            <Link className="topbar-nav-link active" href="/performance">실적현황</Link>
          </nav>
        </div>
        <Announcement isAdmin={false} />
        <div className="topbar-right">
          <span className="topbar-user">{name}님</span>
          <button className="logout-btn" onClick={() => setChangingPassword(true)}>비밀번호 변경</button>
          <button className="logout-btn" onClick={handleLogout}>로그아웃</button>
        </div>
      </div>

      <div className="page-body">
        <div className="page-heading">
          <div>
            <h1>컨택 실적현황</h1>
          </div>
          <button className="btn" onClick={() => fetchData(true)} disabled={loading}>
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>

        {error && (
          <div style={{ color: 'var(--red)', padding: '12px 0', textAlign: 'center' }}>{error}</div>
        )}

        {loading && !rawData && (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--gray)' }}>불러오는 중…</div>
        )}

        {rawData && (
          <>
            {/* ── 요약 카드 ──────────────────────────────────────────────── */}
            {summary && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
                {[
                  { label: '총 DB',   value: summary.totalDB },
                  { label: 'App 가입', value: summary.appJoin },
                  { label: '직전 60일', value: summary.prev60 },
                  { label: '직전 90일', value: summary.prev90 },
                ].map(({ label, value }) => (
                  <div key={label} style={{
                    background: '#fff', border: '1px solid var(--border)',
                    borderRadius: 8, padding: '16px 20px',
                  }}>
                    <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtNum(parseNum(value))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── 뷰 토글 ────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              {['monthly', 'weekly', 'daily'].map((m) => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  className={`btn${viewMode === m ? ' btn-primary' : ''}`}
                  style={{ padding: '5px 14px', fontSize: 13 }}
                >
                  {{ monthly: '월별', weekly: '주별', daily: '일별' }[m]}
                </button>
              ))}
            </div>

            {/* ── 막대 차트 ──────────────────────────────────────────────── */}
            {chartData.length > 0 ? (
              <div style={{
                background: '#fcfcfb', border: '1px solid #e1e0d9',
                borderRadius: 8, padding: '20px 8px 12px', marginBottom: 20,
              }}>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={chartData}
                    margin={{ top: 16, right: 20, left: 0, bottom: 4 }}
                    barCategoryGap="30%"
                    barGap={2}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" vertical={false} />
                    <XAxis
                      dataKey="period"
                      tick={{ fontSize: 11, fill: '#898781' }}
                      axisLine={{ stroke: '#c3c2b7' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#898781' }}
                      axisLine={false}
                      tickLine={false}
                      width={32}
                      allowDecimals={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(42,120,214,0.06)' }} />
                    <Legend
                      iconType="square"
                      iconSize={10}
                      wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                    />
                    {CHART_METRICS.map((metric) => (
                      <Bar key={metric} dataKey={metric} fill={METRIC_COLORS[metric]} radius={[3, 3, 0, 0]} maxBarSize={40}>
                        {/* 대비 경고 슬롯(aqua, yellow)에 직접 라벨 표시 */}
                        {(metric === '최초컨택수' || metric === 'App가입') && (
                          <LabelList dataKey={metric} position="top" style={{ fontSize: 10, fill: '#52514e' }}
                            formatter={(v) => v === 0 ? '' : v} />
                        )}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{
                background: '#fcfcfb', border: '1px solid #e1e0d9',
                borderRadius: 8, padding: 40, textAlign: 'center',
                color: 'var(--gray)', marginBottom: 20,
              }}>
                {viewMode === 'monthly' ? '월별' : viewMode === 'weekly' ? '주별' : '일별'} 집계 데이터가 없습니다.
              </div>
            )}

            {/* ── 상세 테이블 ────────────────────────────────────────────── */}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ minWidth: 72 }}>그룹</th>
                    <th style={{ minWidth: 88 }}>구분</th>
                    {tableCols.map((dc, i) => (
                      <th key={i} style={{ textAlign: 'right', minWidth: 70 }}>
                        {viewMode === 'monthly' ? dc.month :
                         viewMode === 'weekly'  ? dc.week  : dc.day}
                      </th>
                    ))}
                    {viewMode === 'monthly' && tableCols.length >= 2 && (
                      <th style={{ textAlign: 'right', minWidth: 76, borderLeft: '2px solid var(--border)', background: '#f5f5f3', color: 'var(--gray)', fontSize: 11 }}>
                        전월대비
                      </th>
                    )}
                    {viewMode !== 'monthly' && prevMonthCol && (
                      <th style={{ textAlign: 'right', minWidth: 76, borderLeft: '2px solid var(--border)', background: '#f5f5f3', color: 'var(--gray)', fontSize: 11 }}>
                        전월합계<br /><span style={{ fontSize: 10 }}>{prevMonthCol.month}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr className="empty-row">
                      <td colSpan={99}>실적 데이터가 없습니다.</td>
                    </tr>
                  ) : (
                    rows.map((row, ri) => {
                      let monthlyDelta = null;
                      if (viewMode === 'monthly' && tableCols.length >= 2) {
                        const currVal = parseNum(row.dateValues[dateColumns.indexOf(tableCols[tableCols.length - 1])] ?? '');
                        const prevVal = parseNum(row.dateValues[dateColumns.indexOf(tableCols[tableCols.length - 2])] ?? '');
                        monthlyDelta = currVal - prevVal;
                      }
                      const prevMonthRaw = prevMonthCol != null
                        ? (row.dateValues[dateColumns.indexOf(prevMonthCol)] ?? '')
                        : '';
                      return (
                        <tr key={ri}>
                          <td>{row.group}</td>
                          <td style={{ color: METRIC_COLORS[row.metric] || 'var(--navy)', fontWeight: 600 }}>
                            {row.metric}
                          </td>
                          {tableCols.map((dc, ci) => {
                            const globalIdx = dateColumns.indexOf(dc);
                            const raw = row.dateValues[globalIdx] ?? '';
                            return (
                              <td key={ci} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {raw === '' || raw === '-' ? '-' : raw}
                              </td>
                            );
                          })}
                          {viewMode === 'monthly' && tableCols.length >= 2 && (
                            <td style={{
                              textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                              borderLeft: '2px solid var(--border)', background: '#f5f5f3',
                              color: monthlyDelta > 0 ? '#008300' : monthlyDelta < 0 ? 'var(--red)' : 'var(--gray)',
                            }}>
                              {monthlyDelta === 0 ? '-'
                                : (monthlyDelta > 0 ? '▲' : '▼') + Math.abs(monthlyDelta).toLocaleString('ko-KR')}
                            </td>
                          )}
                          {viewMode !== 'monthly' && prevMonthCol && (
                            <td style={{
                              textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                              borderLeft: '2px solid var(--border)', background: '#f5f5f3', color: 'var(--gray)',
                            }}>
                              {prevMonthRaw === '' || prevMonthRaw === '-' ? '-' : prevMonthRaw}
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  );
}
