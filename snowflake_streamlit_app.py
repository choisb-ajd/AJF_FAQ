import streamlit as st
import pandas as pd
from snowflake.snowpark.context import get_active_session
import altair as alt
from datetime import date, timedelta
import calendar

st.set_page_config(layout="wide", page_title="영업현황 대시보드")

st.markdown("""
<style>
[data-testid="stAppViewContainer"] { background: #ffffff; }
[data-testid="stSidebar"] { background: #f8f9fa; }
[data-testid="stHeader"] { background: #ffffff; }
.kpi-card {
    background: #f0f2f6; border-radius: 8px; padding: 16px 12px;
    text-align: center; border: 1px solid #e0e0e0; margin-bottom: 8px;
}
.kpi-label   { color: #555555; font-size: 11px; margin-bottom: 6px; }
.kpi-value   { color: #1a1a1a; font-size: 22px; font-weight: 700; }
.kpi-value-lg{ color: #1a1a1a; font-size: 17px; font-weight: 700; }
.kpi-up      { color: #e03131; font-size: 11px; margin-top: 4px; }
.kpi-down    { color: #1971c2; font-size: 11px; margin-top: 4px; }
.kpi-neutral { color: #999999; font-size: 11px; margin-top: 4px; }
.section-title {
    color: #222222; font-size: 13px; font-weight: 600;
    margin: 20px 0 10px 0; padding-bottom: 5px;
    border-bottom: 2px solid #e0e0e0;
}
.empty-box {
    background: #f8f9fa; border-radius: 6px; padding: 20px;
    text-align: center; color: #aaaaaa; font-size: 12px;
    border: 1px dashed #cccccc;
}
</style>
""", unsafe_allow_html=True)

# ── 세션 / 상수 ──
session = get_active_session()

CHART_BG = "#f0f2f6"
AXIS_C   = "#333333"
GRID_C   = "#dddddd"
BAR_MAIN = "#4c78a8"

MANAGER_LIST = ['김경선','김미희','박순미','송민선','신영란','이선','이선이','정혜령','최현정']

CH_EXPR = """
    CASE
        WHEN cv.REGISTRATION_TYPE = 'RENEWAL'  THEN '갱신'
        WHEN ca.CHANNEL_PATH = 'INBOUND'        THEN 'CS'
        WHEN ca.CHANNEL_PATH = 'DEALER_APP'     THEN '딜러앱'
        ELSE '기타'
    END
"""

# USERS 필터: 준회원 제외(IS_ASSOCIATE=0이 정회원), 테스트 매니저 제외
# USERS 테이블에 DELETED_AT 컬럼 없음
USER_FILTER = "IS_ASSOCIATE = 0 AND USER_NAME NOT LIKE '%테스트%'"


def apply_theme(chart):
    return (
        chart
        .configure_view(fill=CHART_BG, stroke=None)
        .configure_axis(
            labelColor=AXIS_C, titleColor=AXIS_C,
            gridColor=GRID_C, domainColor="#cccccc",
            labelFontSize=11, titleFontSize=11
        )
        .configure_legend(
            labelColor=AXIS_C, titleColor=AXIS_C,
            labelFontSize=11, titleFontSize=11,
            fillColor=CHART_BG, strokeColor="#e0e0e0"
        )
        .configure_title(color=AXIS_C)
    )


def fmt_won(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return "-"
    v = int(v)
    if abs(v) >= 100_000_000:
        return f"{v/100_000_000:.1f}억"
    if abs(v) >= 10_000:
        return f"{v/10_000:.0f}만"
    return f"{v:,}"


def fmt_won_full(v):
    """전체 금액 표시 (억 단위 + 만원 단위 조합)"""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return "-"
    v = int(v)
    if abs(v) >= 100_000_000:
        uk = v // 100_000_000
        man = (abs(v) % 100_000_000) // 10_000
        if man:
            return f"{uk}억 {man:,}만원"
        return f"{uk}억원"
    if abs(v) >= 10_000:
        return f"{v//10_000:,}만원"
    return f"{v:,}원"


def kpi_card(label, value, delta=None, delta_type="neutral"):
    delta_html = ""
    if delta is not None:
        cls = f"kpi-{delta_type}"
        delta_html = f'<div class="{cls}">{delta}</div>'
    return f"""
    <div class="kpi-card">
        <div class="kpi-label">{label}</div>
        <div class="kpi-value">{value}</div>
        {delta_html}
    </div>"""


st.title("영업현황")

# ════════════════════════════════════
# KPI 섹션
# ════════════════════════════════════
st.markdown('<div class="section-title">실시간 지표</div>', unsafe_allow_html=True)

today = date.today()
this_month_start = today.replace(day=1)
last_month_end   = this_month_start - timedelta(days=1)
last_month_start = last_month_end.replace(day=1)
same_period_end  = min(last_month_end, last_month_start.replace(day=today.day))


@st.cache_data(ttl=300)
def get_kpi_premium():
    r = session.sql(f"""
        SELECT
            SUM(CASE WHEN DATE_TRUNC('MONTH', ca.JOIN_COMPLETED_AT) = DATE_TRUNC('MONTH', CURRENT_DATE)
                     THEN cv.CONTRACT_AMOUNT ELSE 0 END) AS cur_month,
            SUM(CASE WHEN ca.JOIN_COMPLETED_AT::DATE BETWEEN '{last_month_start}' AND '{same_period_end}'
                     THEN cv.CONTRACT_AMOUNT ELSE 0 END) AS last_same
        FROM AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
        LEFT JOIN AJDCAR_PROD.PUBLIC.COUNSEL_VEHICLE cv
            ON ca.COUNSEL_ID = cv.COUNSEL_ID
            AND (cv.IS_DELETED = FALSE OR cv.IS_DELETED IS NULL)
        WHERE ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
          AND ca.JOIN_COMPLETED_AT IS NOT NULL
          AND (ca.IS_DELETED = FALSE OR ca.IS_DELETED IS NULL)
    """).collect()
    return r[0]


@st.cache_data(ttl=300)
def get_kpi_users():
    # 누적: IS_ASSOCIATE=0(정회원), 테스트 제외
    r = session.sql(f"""
        SELECT
            COUNT(CASE WHEN DATE_TRUNC('MONTH', CREATED_AT) = DATE_TRUNC('MONTH', CURRENT_DATE)
                       THEN 1 END) AS this_month,
            COUNT(*) AS total
        FROM AJDCAR_PROD.PUBLIC.USERS
        WHERE {USER_FILTER}
    """).collect()
    return r[0]


@st.cache_data(ttl=300)
def get_kpi_active_dealer():
    # 직전 60일 내 계약체결 1건 이상인 정회원 딜러
    r = session.sql(f"""
        SELECT COUNT(DISTINCT ca.USER_ID) AS active_60
        FROM AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
        JOIN AJDCAR_PROD.PUBLIC.USERS u ON ca.USER_ID = u.ID
        WHERE ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
          AND ca.JOIN_COMPLETED_AT >= DATEADD('DAY', -60, CURRENT_DATE)
          AND (ca.IS_DELETED = FALSE OR ca.IS_DELETED IS NULL)
          AND u.IS_ASSOCIATE = 0
          AND u.USER_NAME NOT LIKE '%테스트%'
    """).collect()
    total_r = session.sql(f"""
        SELECT COUNT(*) AS total_dealer
        FROM AJDCAR_PROD.PUBLIC.USERS
        WHERE {USER_FILTER}
    """).collect()
    active = r[0]["ACTIVE_60"]
    total  = total_r[0]["TOTAL_DEALER"]
    rate   = (active / total * 100) if total else 0
    return active, total, rate


kpi_prem = get_kpi_premium()
kpi_usr  = get_kpi_users()
active60, total_users, active_rate = get_kpi_active_dealer()

cur = kpi_prem["CUR_MONTH"] or 0
lst = kpi_prem["LAST_SAME"] or 0
if lst > 0:
    pct      = (cur - lst) / lst * 100
    diff_amt = cur - lst
    pct_txt  = f"전월동기 대비 {'+' if pct>=0 else ''}{pct:.1f}%"
    amt_txt  = f"({'+' if diff_amt>=0 else ''}{fmt_won_full(diff_amt)})"
    d_type   = "up" if pct >= 0 else "down"
    delta_lines = f'<div class="kpi-{d_type}">{pct_txt}</div><div class="kpi-{d_type}">{amt_txt}</div>'
else:
    delta_lines = '<div class="kpi-neutral">전월동기 데이터 없음</div>'
    d_type = "neutral"

col1, col2, col3 = st.columns(3)
with col1:
    st.markdown(f"""
    <div class="kpi-card">
        <div class="kpi-label">당월 총 원수보험료</div>
        <div class="kpi-value">{fmt_won_full(cur)}</div>
        {delta_lines}
    </div>""", unsafe_allow_html=True)
with col2:
    st.markdown(kpi_card("당월 앱 가입자수", f"{kpi_usr['THIS_MONTH']:,}명"), unsafe_allow_html=True)
with col3:
    st.markdown(kpi_card("누적 앱 가입자수", f"{kpi_usr['TOTAL']:,}명"), unsafe_allow_html=True)

col4, col5, col6 = st.columns(3)
with col4:
    st.markdown(kpi_card("직전 60일 활동딜러", f"{active60:,}명"), unsafe_allow_html=True)
with col5:
    st.markdown(kpi_card("활동률", f"{active_rate:.1f}%", f"전체 {total_users:,}명 중"), unsafe_allow_html=True)
with col6:
    st.markdown('<div class="kpi-card"><div class="kpi-label">오프영업팀 가입건</div><div class="kpi-value-lg" style="color:#aaa;">-</div><div class="kpi-neutral">데이터 준비중</div></div>', unsafe_allow_html=True)

# ════════════════════════════════════
# 앱 가입현황 G1~G5 (빈 구조)
# ════════════════════════════════════
st.markdown('<div class="section-title">앱 가입현황 (딜러그룹별)</div>', unsafe_allow_html=True)
g_cols = st.columns(5)
for i, col in enumerate(g_cols, 1):
    with col:
        st.markdown(f'<div class="kpi-card"><div class="kpi-label">G{i}</div><div class="kpi-value-lg" style="color:#aaa;">-</div><div class="kpi-neutral">데이터 준비중</div></div>', unsafe_allow_html=True)

# ════════════════════════════════════
# 직전 60일/90일 계약체결구간별 딜러 분포 (ProgressColumn 표)
# ════════════════════════════════════
st.markdown('<div class="section-title">계약체결 구간별 딜러 분포</div>', unsafe_allow_html=True)

DIST_ORDER = ["1건", "2건", "3건", "4~6건", "7건 이상"]


@st.cache_data(ttl=300)
def get_dealer_dist(days):
    df = session.sql(f"""
        WITH dealer_cnt AS (
            SELECT ca.USER_ID, COUNT(*) AS cnt
            FROM AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
            JOIN AJDCAR_PROD.PUBLIC.USERS u ON ca.USER_ID = u.ID
            WHERE ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
              AND ca.JOIN_COMPLETED_AT >= DATEADD('DAY', -{days}, CURRENT_DATE)
              AND (ca.IS_DELETED = FALSE OR ca.IS_DELETED IS NULL)
              AND u.IS_ASSOCIATE = 0
              AND u.USER_NAME NOT LIKE '%테스트%'
            GROUP BY 1
        )
        SELECT
            CASE
                WHEN cnt = 1  THEN '1건'
                WHEN cnt = 2  THEN '2건'
                WHEN cnt = 3  THEN '3건'
                WHEN cnt <= 6 THEN '4~6건'
                ELSE '7건 이상'
            END AS "구간",
            COUNT(*) AS "딜러수",
            SUM(cnt)  AS "체결건수"
        FROM dealer_cnt
        GROUP BY 1
        ORDER BY MIN(cnt)
    """).to_pandas()
    df.columns = ["구간", "딜러수", "체결건수"]
    df["구간"] = pd.Categorical(df["구간"], categories=DIST_ORDER, ordered=True)
    df = df.sort_values("구간").reset_index(drop=True)
    return df


dcol1, dcol2 = st.columns(2)
with dcol1:
    st.caption("직전 60일 딜러 분포")
    df60 = get_dealer_dist(60)
    if not df60.empty:
        st.dataframe(
            df60,
            column_config={
                "구간":    st.column_config.TextColumn("체결건수 구간", width="small"),
                "딜러수":  st.column_config.ProgressColumn(
                    "딜러수", min_value=0,
                    max_value=int(df60["딜러수"].max()), format="%d"
                ),
                "체결건수": st.column_config.ProgressColumn(
                    "체결건수", min_value=0,
                    max_value=int(df60["체결건수"].max()), format="%d"
                ),
            },
            hide_index=True, use_container_width=True
        )
    else:
        st.info("데이터 없음")

with dcol2:
    st.caption("직전 90일 딜러 분포")
    df90 = get_dealer_dist(90)
    if not df90.empty:
        st.dataframe(
            df90,
            column_config={
                "구간":    st.column_config.TextColumn("체결건수 구간", width="small"),
                "딜러수":  st.column_config.ProgressColumn(
                    "딜러수", min_value=0,
                    max_value=int(df90["딜러수"].max()), format="%d"
                ),
                "체결건수": st.column_config.ProgressColumn(
                    "체결건수", min_value=0,
                    max_value=int(df90["체결건수"].max()), format="%d"
                ),
            },
            hide_index=True, use_container_width=True
        )
    else:
        st.info("데이터 없음")

# ════════════════════════════════════
# 추이 차트
# ════════════════════════════════════
st.markdown('<div class="section-title">추이 차트</div>', unsafe_allow_html=True)
ch_left, ch_right = st.columns(2)

with ch_left:
    st.caption("직전 50일 일별 총 원수보험료")

    @st.cache_data(ttl=300)
    def get_daily50():
        df = session.sql("""
            SELECT
                DATE_TRUNC('DAY', ca.JOIN_COMPLETED_AT)::DATE AS "일자",
                SUM(cv.CONTRACT_AMOUNT) AS "원수보험료"
            FROM AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
            LEFT JOIN AJDCAR_PROD.PUBLIC.COUNSEL_VEHICLE cv
                ON ca.COUNSEL_ID = cv.COUNSEL_ID
                AND (cv.IS_DELETED = FALSE OR cv.IS_DELETED IS NULL)
            WHERE ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
              AND ca.JOIN_COMPLETED_AT IS NOT NULL
              AND (ca.IS_DELETED = FALSE OR ca.IS_DELETED IS NULL)
              AND DATE_TRUNC('DAY', ca.JOIN_COMPLETED_AT)::DATE
                  >= DATEADD('DAY', -50, CURRENT_DATE)
            GROUP BY 1 ORDER BY 1
        """).to_pandas()
        df.columns = ["일자", "원수보험료"]
        df["일자"] = pd.to_datetime(df["일자"])
        return df

    df50 = get_daily50()
    if not df50.empty:
        avg_val = df50["원수보험료"].mean()
        bar50 = alt.Chart(df50).mark_bar(color=BAR_MAIN, size=7).encode(
            x=alt.X("일자:T", title="일자",
                    axis=alt.Axis(format="%m/%d", labelAngle=-45, tickCount=10)),
            y=alt.Y("원수보험료:Q", title="원수보험료(원)", axis=alt.Axis(format=",.0f")),
            tooltip=[
                alt.Tooltip("일자:T", title="날짜", format="%Y-%m-%d"),
                alt.Tooltip("원수보험료:Q", title="원수보험료", format=",.0f")
            ]
        )
        avg_rule = alt.Chart(pd.DataFrame({"avg": [avg_val]})).mark_rule(
            color="#e03131", strokeDash=[4,3], strokeWidth=1.5
        ).encode(y="avg:Q")
        avg_text = alt.Chart(pd.DataFrame({
            "avg": [avg_val], "x": [df50["일자"].iloc[-1]],
            "lbl": [f"평균 {avg_val/10000:.0f}만"]
        })).mark_text(
            align="right", dx=-4, dy=-8, color="#e03131", fontSize=10
        ).encode(x="x:T", y="avg:Q", text="lbl:N")
        st.altair_chart(
            apply_theme((bar50 + avg_rule + avg_text).properties(height=260, background=CHART_BG)),
            use_container_width=True
        )
    else:
        st.info("데이터 없음")

with ch_right:
    st.caption("월별/주차별 앱 가입현황")
    view_unit = st.radio("조회 단위", ["월별", "주차별"], horizontal=True, key="signup_unit")

    @st.cache_data(ttl=300)
    def get_signup(unit):
        if unit == "월별":
            sql = f"""
                SELECT TO_CHAR(CREATED_AT, 'YYYY-MM') AS "기간_str",
                       COUNT(*) AS "가입수"
                FROM AJDCAR_PROD.PUBLIC.USERS
                WHERE CREATED_AT IS NOT NULL AND {USER_FILTER}
                GROUP BY 1 ORDER BY 1 DESC
            """
        else:
            sql = f"""
                SELECT TO_CHAR(DATE_TRUNC('WEEK', CREATED_AT), 'YYYY-MM-DD') AS "기간_str",
                       COUNT(*) AS "가입수"
                FROM AJDCAR_PROD.PUBLIC.USERS
                WHERE CREATED_AT IS NOT NULL AND {USER_FILTER}
                GROUP BY 1 ORDER BY 1 DESC
            """
        df = session.sql(sql).to_pandas()
        df.columns = ["기간_str", "가입수"]
        return df

    df_sg = get_signup(view_unit)
    if not df_sg.empty:
        order = list(df_sg["기간_str"])
        bar_sg = alt.Chart(df_sg).mark_bar(color=BAR_MAIN).encode(
            x=alt.X("기간_str:N", title="기간", sort=order,
                    axis=alt.Axis(labelAngle=-45)),
            y=alt.Y("가입수:Q", title="가입수"),
            tooltip=[
                alt.Tooltip("기간_str:N", title="기간"),
                alt.Tooltip("가입수:Q", title="가입수", format=",")
            ]
        )
        lbl_sg = bar_sg.mark_text(dy=-6, fontSize=10, color="#333333").encode(
            text=alt.Text("가입수:Q", format=",")
        )
        st.altair_chart(
            apply_theme((bar_sg + lbl_sg).properties(height=260, background=CHART_BG)),
            use_container_width=True
        )
    else:
        st.info("데이터 없음")

# ════════════════════════════════════
# 필터 섹션
# ════════════════════════════════════
st.markdown('<div class="section-title">상세 분석 (필터)</div>', unsafe_allow_html=True)

f1, f2, f3, f4 = st.columns(4)
with f1:
    date_from = st.date_input("시작일", value=date(today.year, today.month, 1))
with f2:
    date_to = st.date_input("종료일", value=today)
with f3:
    mgr_opts = ["전체"] + MANAGER_LIST
    sel_mgr  = st.selectbox("담당매니저", mgr_opts)
with f4:
    ch_opts = ["전체", "갱신", "CS", "딜러앱", "기타"]
    sel_ch  = st.selectbox("영업채널", ch_opts)

mgr_filter = "" if sel_mgr == "전체" else f"AND m.NAME = '{sel_mgr}'"
ch_filter  = "" if sel_ch  == "전체" else f"AND {CH_EXPR} = '{sel_ch}'"

# ════════════════════════════════════
# 체결월별 / 주차별 영업채널 보험료
# ════════════════════════════════════
st.markdown('<div class="section-title">체결월별 영업채널 원수보험료</div>', unsafe_allow_html=True)
period_unit = st.radio("기간 단위", ["월별", "주차별"], horizontal=True, key="period_unit")


@st.cache_data(ttl=300)
def get_channel_premium(d_from, d_to, mgr_f, ch_f, unit):
    grp = "TO_CHAR(ca.JOIN_COMPLETED_AT, 'YYYY-MM')" if unit == "월별" \
          else "TO_CHAR(DATE_TRUNC('WEEK', ca.JOIN_COMPLETED_AT), 'YYYY-MM-DD')"
    df = session.sql(f"""
        SELECT
            {grp} AS "기간",
            {CH_EXPR} AS "채널",
            SUM(cv.CONTRACT_AMOUNT) AS "원수보험료"
        FROM AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
        LEFT JOIN AJDCAR_PROD.PUBLIC.COUNSEL_VEHICLE cv
            ON ca.COUNSEL_ID = cv.COUNSEL_ID
            AND (cv.IS_DELETED = FALSE OR cv.IS_DELETED IS NULL)
        LEFT JOIN AJDCAR_PROD.PUBLIC.USERS u ON ca.USER_ID = u.ID
        LEFT JOIN AJDCAR_PROD.PUBLIC.MANAGER m ON ca.COUNSEL_MANAGER_ID = m.ID
        WHERE ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
          AND ca.JOIN_COMPLETED_AT IS NOT NULL
          AND (ca.IS_DELETED = FALSE OR ca.IS_DELETED IS NULL)
          AND ca.JOIN_COMPLETED_AT::DATE BETWEEN '{d_from}' AND '{d_to}'
          AND m.NAME NOT LIKE '%테스트%'
          {mgr_f} {ch_f}
        GROUP BY 1,2 ORDER BY 1 DESC
    """).to_pandas()
    df.columns = ["기간", "채널", "원수보험료"]
    return df


df_ch = get_channel_premium(date_from, date_to, mgr_filter, ch_filter, period_unit)
if not df_ch.empty:
    order_ch = sorted(df_ch["기간"].unique(), reverse=True)
    totals_ch = df_ch.groupby("기간")["원수보험료"].sum().reset_index()
    totals_ch.columns = ["기간", "합계"]

    bar_ch = alt.Chart(df_ch).mark_bar().encode(
        x=alt.X("기간:N", sort=order_ch, title="기간", axis=alt.Axis(labelAngle=-45)),
        y=alt.Y("원수보험료:Q", title="원수보험료(원)", axis=alt.Axis(format=",.0f")),
        color=alt.Color("채널:N", legend=alt.Legend(title="채널")),
        tooltip=[
            alt.Tooltip("기간:N"), alt.Tooltip("채널:N"),
            alt.Tooltip("원수보험료:Q", format=",.0f")
        ]
    )
    lbl_ch = alt.Chart(totals_ch).mark_text(dy=-6, fontSize=10, color="#333333").encode(
        x=alt.X("기간:N", sort=order_ch),
        y=alt.Y("합계:Q"),
        text=alt.Text("합계:Q", format=",.0f")
    )
    st.altair_chart(
        apply_theme((bar_ch + lbl_ch).properties(height=280, background=CHART_BG)),
        use_container_width=True
    )
else:
    st.info("데이터 없음")

# ════════════════════════════════════
# 체결월별 가동딜러수 + 딜러그룹별 인당 원수보험료
# ════════════════════════════════════
st.markdown('<div class="section-title">딜러 현황</div>', unsafe_allow_html=True)
dl1, dl2 = st.columns(2)

with dl1:
    st.caption("체결월별 가동딜러수")

    @st.cache_data(ttl=300)
    def get_active_dealer_monthly(d_from, d_to, mgr_f):
        df = session.sql(f"""
            SELECT
                TO_CHAR(ca.JOIN_COMPLETED_AT, 'YYYY-MM') AS "월",
                COUNT(DISTINCT ca.USER_ID) AS "가동딜러수"
            FROM AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
            LEFT JOIN AJDCAR_PROD.PUBLIC.MANAGER m ON ca.COUNSEL_MANAGER_ID = m.ID
            WHERE ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
              AND ca.JOIN_COMPLETED_AT IS NOT NULL
              AND (ca.IS_DELETED = FALSE OR ca.IS_DELETED IS NULL)
              AND ca.JOIN_COMPLETED_AT::DATE BETWEEN '{d_from}' AND '{d_to}'
              AND m.NAME NOT LIKE '%테스트%'
              {mgr_f}
            GROUP BY 1 ORDER BY 1 DESC
        """).to_pandas()
        df.columns = ["월", "가동딜러수"]
        return df

    df_adm = get_active_dealer_monthly(date_from, date_to, mgr_filter)
    if not df_adm.empty:
        order_adm = list(df_adm["월"])
        c = apply_theme(
            alt.Chart(df_adm).mark_bar(color="#6a9fd8").encode(
                x=alt.X("월:N", sort=order_adm, title=None, axis=alt.Axis(labelAngle=-30)),
                y=alt.Y("가동딜러수:Q", title="가동딜러수"),
                tooltip=[alt.Tooltip("월:N"), alt.Tooltip("가동딜러수:Q", format=",")]
            ).properties(height=220, background=CHART_BG)
        )
        st.altair_chart(c, use_container_width=True)
    else:
        st.info("데이터 없음")

with dl2:
    st.caption("딜러그룹별 인당 원수보험료")

    @st.cache_data(ttl=300)
    def get_per_dealer(d_from, d_to):
        df = session.sql(f"""
            SELECT
                COALESCE(u.BUSINESS_TYPE, '미분류') AS "딜러유형",
                SUM(cv.CONTRACT_AMOUNT) / NULLIF(COUNT(DISTINCT ca.USER_ID), 0) AS "인당원수보험료"
            FROM AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
            LEFT JOIN AJDCAR_PROD.PUBLIC.COUNSEL_VEHICLE cv
                ON ca.COUNSEL_ID = cv.COUNSEL_ID
                AND (cv.IS_DELETED = FALSE OR cv.IS_DELETED IS NULL)
            LEFT JOIN AJDCAR_PROD.PUBLIC.USERS u ON ca.USER_ID = u.ID
            WHERE ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
              AND ca.JOIN_COMPLETED_AT IS NOT NULL
              AND (ca.IS_DELETED = FALSE OR ca.IS_DELETED IS NULL)
              AND ca.JOIN_COMPLETED_AT::DATE BETWEEN '{d_from}' AND '{d_to}'
              AND u.USER_NAME NOT LIKE '%테스트%'
            GROUP BY 1 ORDER BY 2 DESC
        """).to_pandas()
        df.columns = ["딜러유형", "인당원수보험료"]
        return df

    df_pd = get_per_dealer(date_from, date_to)
    if not df_pd.empty:
        c = apply_theme(
            alt.Chart(df_pd).mark_bar(color="#f4a261").encode(
                y=alt.Y("딜러유형:N", sort="-x", title=None),
                x=alt.X("인당원수보험료:Q", title="인당 원수보험료(원)", axis=alt.Axis(format=",.0f")),
                tooltip=[alt.Tooltip("딜러유형:N"),
                         alt.Tooltip("인당원수보험료:Q", format=",.0f")]
            ).properties(height=220, background=CHART_BG)
        )
        st.altair_chart(c, use_container_width=True)
    else:
        st.info("데이터 없음")

# ════════════════════════════════════
# 당월 보험사별 원수보험료/건수
# ════════════════════════════════════
st.markdown('<div class="section-title">당월 보험사별 현황</div>', unsafe_allow_html=True)


@st.cache_data(ttl=300)
def get_insurer_monthly():
    df = session.sql(f"""
        SELECT
            cv.JOIN_INSURER_CODE AS "보험사",
            SUM(cv.CONTRACT_AMOUNT) AS "원수보험료",
            COUNT(*) AS "건수"
        FROM AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
        LEFT JOIN AJDCAR_PROD.PUBLIC.COUNSEL_VEHICLE cv
            ON ca.COUNSEL_ID = cv.COUNSEL_ID
            AND (cv.IS_DELETED = FALSE OR cv.IS_DELETED IS NULL)
        WHERE ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
          AND ca.JOIN_COMPLETED_AT IS NOT NULL
          AND (ca.IS_DELETED = FALSE OR ca.IS_DELETED IS NULL)
          AND DATE_TRUNC('MONTH', ca.JOIN_COMPLETED_AT) = DATE_TRUNC('MONTH', CURRENT_DATE)
        GROUP BY 1 ORDER BY 2 DESC
    """).to_pandas()
    df.columns = ["보험사", "원수보험료", "건수"]
    return df


df_ins = get_insurer_monthly()
ins1, ins2 = st.columns(2)
with ins1:
    st.caption("원수보험료")
    if not df_ins.empty:
        c = apply_theme(
            alt.Chart(df_ins).mark_bar(color=BAR_MAIN).encode(
                y=alt.Y("보험사:N", sort="-x", title=None),
                x=alt.X("원수보험료:Q", title="원수보험료(원)", axis=alt.Axis(format=",.0f")),
                tooltip=[alt.Tooltip("보험사:N"), alt.Tooltip("원수보험료:Q", format=",.0f")]
            ).properties(height=220, background=CHART_BG)
        )
        st.altair_chart(c, use_container_width=True)
    else:
        st.info("데이터 없음")

with ins2:
    st.caption("건수")
    if not df_ins.empty:
        c = apply_theme(
            alt.Chart(df_ins).mark_bar(color="#5ba85a").encode(
                y=alt.Y("보험사:N", sort="-x", title=None),
                x=alt.X("건수:Q", title="건수"),
                tooltip=[alt.Tooltip("보험사:N"), alt.Tooltip("건수:Q", format=",")]
            ).properties(height=220, background=CHART_BG)
        )
        st.altair_chart(c, use_container_width=True)
    else:
        st.info("데이터 없음")

# ════════════════════════════════════
# 직전 3개월 보험사/가입유형별 피벗 표
# ════════════════════════════════════
st.markdown('<div class="section-title">직전 3개월 보험사 × 가입유형별 원수보험료</div>', unsafe_allow_html=True)


@st.cache_data(ttl=300)
def get_pivot_3m():
    df = session.sql(f"""
        SELECT
            TO_CHAR(ca.JOIN_COMPLETED_AT, 'YYYY-MM') AS "월",
            cv.JOIN_INSURER_CODE AS "보험사",
            {CH_EXPR} AS "채널",
            SUM(cv.CONTRACT_AMOUNT) AS "원수보험료",
            COUNT(*) AS "건수"
        FROM AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
        LEFT JOIN AJDCAR_PROD.PUBLIC.COUNSEL_VEHICLE cv
            ON ca.COUNSEL_ID = cv.COUNSEL_ID
            AND (cv.IS_DELETED = FALSE OR cv.IS_DELETED IS NULL)
        WHERE ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
          AND ca.JOIN_COMPLETED_AT IS NOT NULL
          AND (ca.IS_DELETED = FALSE OR ca.IS_DELETED IS NULL)
          AND ca.JOIN_COMPLETED_AT >= DATEADD('MONTH', -3, DATE_TRUNC('MONTH', CURRENT_DATE))
        GROUP BY 1,2,3 ORDER BY 1 DESC,2,3
    """).to_pandas()
    df.columns = ["월", "보험사", "채널", "원수보험료", "건수"]
    return df


df_pv = get_pivot_3m()
if not df_pv.empty:
    pivot = df_pv.pivot_table(
        index=["보험사", "채널"],
        columns="월",
        values="원수보험료",
        aggfunc="sum",
        fill_value=0
    ).reset_index()
    month_cols = sorted([c for c in pivot.columns if c not in ["보험사","채널"]], reverse=True)
    pivot = pivot[["보험사","채널"] + month_cols]
    for c in month_cols:
        pivot[c] = pivot[c].apply(lambda x: f"{int(x):,}" if x else "-")
    st.dataframe(pivot, use_container_width=True, hide_index=True)
else:
    st.info("데이터 없음")

# ════════════════════════════════════
# 인입채널 빈 표
# ════════════════════════════════════
st.markdown('<div class="section-title">인입채널별 현황 (오프팀/상조회/B2B)</div>', unsafe_allow_html=True)
st.markdown('<div class="empty-box">데이터 준비중입니다</div>', unsafe_allow_html=True)

# ════════════════════════════════════
# 리텐션 딜러 현황
# ════════════════════════════════════
st.markdown('<div class="section-title">리텐션 딜러 현황</div>', unsafe_allow_html=True)

# 기준월 선택 (최근 12개월)
ret_months = []
_d = today.replace(day=1)
for _ in range(12):
    ret_months.append(_d.strftime("%Y-%m"))
    _d = (_d - timedelta(days=1)).replace(day=1)

sel_base_month = st.selectbox("기준월 선택", ret_months, key="ret_base_month")
_y, _m = int(sel_base_month[:4]), int(sel_base_month[5:7])
_last_day = calendar.monthrange(_y, _m)[1]
base_date = date(_y, _m, _last_day)
base_str  = base_date.strftime("%Y-%m-%d")
ref_60    = (base_date - timedelta(days=60)).strftime("%Y-%m-%d")
ref_60_ago = (base_date - timedelta(days=60)).strftime("%Y-%m-%d")

st.caption(f"기준일: {base_str} (해당 월 말일 기준)")


@st.cache_data(ttl=600)
def get_retention_summary(base_str, ref_60):
    r = session.sql(f"""
        WITH contract_summary AS (
            SELECT
                u.ID                                                    AS user_id,
                u.USER_NAME,
                u.IS_ASSOCIATE,
                u.CREATED_AT::DATE                                       AS reg_date,
                COUNT(ca.COUNSEL_ID)                                     AS total_cnt,
                MAX(CASE WHEN ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
                              AND ca.JOIN_COMPLETED_AT::DATE BETWEEN '{ref_60}' AND '{base_str}'
                         THEN 1 ELSE 0 END)                             AS recent_act
            FROM AJDCAR_PROD.PUBLIC.USERS u
            LEFT JOIN AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
                ON u.ID = ca.USER_ID
                AND ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
                AND ca.JOIN_COMPLETED_AT::DATE <= '{base_str}'
                AND (ca.IS_DELETED = FALSE OR ca.IS_DELETED IS NULL)
            WHERE u.USER_NAME NOT LIKE '%테스트%'
            GROUP BY 1,2,3,4
        )
        SELECT
            SUM(CASE WHEN IS_ASSOCIATE = 0 AND total_cnt = 1  AND recent_act = 0 THEN 1 ELSE 0 END) AS cat1,
            SUM(CASE WHEN IS_ASSOCIATE = 0 AND total_cnt >= 2 AND recent_act = 0 THEN 1 ELSE 0 END) AS cat2,
            SUM(CASE WHEN IS_ASSOCIATE = 0 AND total_cnt = 0
                          AND reg_date <= DATEADD('DAY', -60, '{base_str}')      THEN 1 ELSE 0 END) AS cat3,
            SUM(CASE WHEN IS_ASSOCIATE = 1 AND total_cnt >= 1 AND recent_act = 0 THEN 1 ELSE 0 END) AS cat4
        FROM contract_summary
    """).collect()
    return r[0]


@st.cache_data(ttl=600)
def get_retention_raw(category, base_str, ref_60):
    if category == 1:
        cond = f"IS_ASSOCIATE = 0 AND total_cnt = 1 AND recent_act = 0"
    elif category == 2:
        cond = f"IS_ASSOCIATE = 0 AND total_cnt >= 2 AND recent_act = 0"
    elif category == 3:
        cond = f"IS_ASSOCIATE = 0 AND total_cnt = 0 AND reg_date <= DATEADD('DAY', -60, '{base_str}')"
    else:
        cond = f"IS_ASSOCIATE = 1 AND total_cnt >= 1 AND recent_act = 0"

    df = session.sql(f"""
        WITH contract_summary AS (
            SELECT
                u.ID                                                    AS user_id,
                u.USER_NAME                                             AS "딜러명",
                u.IS_ASSOCIATE                                          AS "준회원여부",
                u.CREATED_AT::DATE                                       AS reg_date,
                COUNT(ca.COUNSEL_ID)                                     AS total_cnt,
                MAX(ca.JOIN_COMPLETED_AT::DATE)                          AS last_contract_date,
                MAX(CASE WHEN ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
                              AND ca.JOIN_COMPLETED_AT::DATE BETWEEN '{ref_60}' AND '{base_str}'
                         THEN 1 ELSE 0 END)                             AS recent_act
            FROM AJDCAR_PROD.PUBLIC.USERS u
            LEFT JOIN AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
                ON u.ID = ca.USER_ID
                AND ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
                AND ca.JOIN_COMPLETED_AT::DATE <= '{base_str}'
                AND (ca.IS_DELETED = FALSE OR ca.IS_DELETED IS NULL)
            WHERE u.USER_NAME NOT LIKE '%테스트%'
            GROUP BY 1,2,3,4
        )
        SELECT
            "딜러명",
            "준회원여부",
            reg_date     AS "가입일",
            total_cnt    AS "총체결건수",
            last_contract_date AS "마지막체결일"
        FROM contract_summary
        WHERE {cond}
        ORDER BY total_cnt DESC, reg_date
    """).to_pandas()
    df.columns = ["딜러명", "준회원여부", "가입일", "총체결건수", "마지막체결일"]
    return df


ret_summary = get_retention_summary(base_str, ref_60)
cat_labels = [
    ("1회 체결 후 미활동", "cat1", "IS_ASSOCIATE=0, 총 체결 1건, 직전 60일 미활동"),
    ("2회 이상 체결 후 미활동", "cat2", "IS_ASSOCIATE=0, 총 체결 ≥2건, 직전 60일 미활동"),
    ("미체결 딜러", "cat3", "IS_ASSOCIATE=0, 계약 0건, 가입 후 60일 초과"),
    ("준회원 미활동", "cat4", "IS_ASSOCIATE=1, 체결 ≥1건, 직전 60일 미활동"),
]

rc1, rc2, rc3, rc4 = st.columns(4)
for col, (lbl, key, desc), cat_num in zip(
    [rc1, rc2, rc3, rc4], cat_labels, [1,2,3,4]
):
    cnt = ret_summary[key.upper()] or 0
    with col:
        st.markdown(kpi_card(lbl, f"{cnt:,}명", desc, "neutral"), unsafe_allow_html=True)

for cat_num, (lbl, key, desc) in enumerate(cat_labels, 1):
    cnt = ret_summary[key.upper()] or 0
    with st.expander(f"▶ {lbl} ({cnt:,}명) 상세"):
        df_raw = get_retention_raw(cat_num, base_str, ref_60)
        if df_raw.empty:
            st.info("해당 딜러 없음")
        else:
            st.dataframe(df_raw, use_container_width=True, hide_index=True)
            csv = df_raw.to_csv(index=False, encoding="utf-8-sig")
            st.download_button(
                label="⬇ CSV 다운로드",
                data=csv,
                file_name=f"retention_cat{cat_num}_{sel_base_month}.csv",
                mime="text/csv",
                key=f"dl_{cat_num}"
            )
