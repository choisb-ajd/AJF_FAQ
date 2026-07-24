import streamlit as st
import pandas as pd
from snowflake.snowpark.context import get_active_session
import altair as alt
from datetime import date, timedelta

st.set_page_config(layout="wide", page_title="영업현황 대시보드")

# ── 흰색/밝은 테마 CSS ──
st.markdown("""
<style>
[data-testid="stAppViewContainer"] { background: #ffffff; }
[data-testid="stSidebar"] { background: #f8f9fa; }
[data-testid="stHeader"] { background: #ffffff; }
.kpi-card {
    background: #f0f2f6; border-radius: 8px; padding: 16px 12px;
    text-align: center; border: 1px solid #e0e0e0; margin-bottom: 8px;
}
.kpi-label  { color: #555555; font-size: 11px; margin-bottom: 6px; }
.kpi-value  { color: #1a1a1a; font-size: 22px; font-weight: 700; }
.kpi-value-lg { color: #1a1a1a; font-size: 17px; font-weight: 700; }
.kpi-up     { color: #e03131; font-size: 11px; margin-top: 4px; }
.kpi-down   { color: #1971c2; font-size: 11px; margin-top: 4px; }
.kpi-neutral{ color: #999999; font-size: 11px; margin-top: 4px; }
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
MGR_IN = "','".join(MANAGER_LIST)

CH_EXPR = """
    CASE
        WHEN cv.REGISTRATION_TYPE = 'RENEWAL'  THEN '갱신'
        WHEN ca.CHANNEL_PATH = 'INBOUND'        THEN 'CS'
        WHEN ca.CHANNEL_PATH = 'DEALER_APP'     THEN '딜러앱'
        ELSE '기타'
    END
"""

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

# 당월 원수보험료
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
    r = session.sql(f"""
        SELECT
            COUNT(CASE WHEN DATE_TRUNC('MONTH', CREATED_AT) = DATE_TRUNC('MONTH', CURRENT_DATE)
                       THEN 1 END) AS this_month,
            COUNT(*) AS total
        FROM AJDCAR_PROD.PUBLIC.USERS
        WHERE NAME NOT LIKE '%테스트%'
    """).collect()
    return r[0]

@st.cache_data(ttl=300)
def get_kpi_active_dealer():
    r = session.sql(f"""
        SELECT
            COUNT(DISTINCT ca.USER_ID) AS active_60
        FROM AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
        WHERE ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
          AND ca.JOIN_COMPLETED_AT >= DATEADD('DAY', -60, CURRENT_DATE)
          AND (ca.IS_DELETED = FALSE OR ca.IS_DELETED IS NULL)
    """).collect()
    total_r = session.sql(f"""
        SELECT COUNT(*) AS total_dealer
        FROM AJDCAR_PROD.PUBLIC.USERS
        WHERE NAME NOT LIKE '%테스트%'
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
    pct = (cur - lst) / lst * 100
    delta_txt  = f"전월동기 대비 {'+' if pct>=0 else ''}{pct:.1f}%"
    delta_type = "up" if pct >= 0 else "down"
else:
    delta_txt, delta_type = "전월동기 데이터 없음", "neutral"

col1, col2, col3 = st.columns(3)
with col1:
    st.markdown(kpi_card("당월 총 원수보험료", fmt_won(cur), delta_txt, delta_type), unsafe_allow_html=True)
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
# 직전 60일/90일 계약체결구간별 딜러 분포
# ════════════════════════════════════
st.markdown('<div class="section-title">계약체결 구간별 딜러 분포</div>', unsafe_allow_html=True)

@st.cache_data(ttl=300)
def get_dealer_dist(days):
    df = session.sql(f"""
        WITH dealer_cnt AS (
            SELECT ca.USER_ID, COUNT(*) AS cnt
            FROM AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
            WHERE ca.COUNSEL_STATUS = 'JOIN_COMPLETED'
              AND ca.JOIN_COMPLETED_AT >= DATEADD('DAY', -{days}, CURRENT_DATE)
              AND (ca.IS_DELETED = FALSE OR ca.IS_DELETED IS NULL)
            GROUP BY 1
        )
        SELECT
            CASE
                WHEN cnt = 0  THEN '0건'
                WHEN cnt = 1  THEN '1건'
                WHEN cnt = 2  THEN '2건'
                WHEN cnt = 3  THEN '3건'
                WHEN cnt <= 6 THEN '4~6건'
                ELSE '7건 이상'
            END AS "구간",
            COUNT(*) AS "딜러수"
        FROM dealer_cnt
        GROUP BY 1
        ORDER BY MIN(cnt)
    """).to_pandas()
    df.columns = ["구간", "딜러수"]
    return df

dcol1, dcol2 = st.columns(2)
with dcol1:
    st.caption("직전 60일")
    df60 = get_dealer_dist(60)
    if not df60.empty:
        c = apply_theme(
            alt.Chart(df60).mark_bar(color=BAR_MAIN).encode(
                x=alt.X("구간:N", sort=["0건","1건","2건","3건","4~6건","7건 이상"], title=None),
                y=alt.Y("딜러수:Q", title="딜러수"),
                tooltip=[alt.Tooltip("구간:N"), alt.Tooltip("딜러수:Q", format=",")]
            ).properties(width=320, height=220, background=CHART_BG)
        )
        st.altair_chart(c, use_container_width=True)

with dcol2:
    st.caption("직전 90일")
    df90 = get_dealer_dist(90)
    if not df90.empty:
        c = apply_theme(
            alt.Chart(df90).mark_bar(color="#5ba85a").encode(
                x=alt.X("구간:N", sort=["0건","1건","2건","3건","4~6건","7건 이상"], title=None),
                y=alt.Y("딜러수:Q", title="딜러수"),
                tooltip=[alt.Tooltip("구간:N"), alt.Tooltip("딜러수:Q", format=",")]
            ).properties(width=320, height=220, background=CHART_BG)
        )
        st.altair_chart(c, use_container_width=True)

# ════════════════════════════════════
# 직전 50일 일별 원수보험료 + 월별/주차별 앱 가입현황
# ════════════════════════════════════
st.markdown('<div class="section-title">추이 차트</div>', unsafe_allow_html=True)
ch_left, ch_right = st.columns(2)

# 직전 50일 일별 원수보험료
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
            y=alt.Y("원수보험료:Q", title="원수보험료(원)",
                    axis=alt.Axis(format=",.0f")),
            tooltip=[
                alt.Tooltip("일자:T", title="날짜", format="%Y-%m-%d"),
                alt.Tooltip("원수보험료:Q", title="원수보험료", format=",.0f")
            ]
        )
        avg_rule = alt.Chart(pd.DataFrame({"avg": [avg_val]})).mark_rule(
            color="#e03131", strokeDash=[4,3], strokeWidth=1.5
        ).encode(y="avg:Q")
        avg_text = alt.Chart(pd.DataFrame({"avg": [avg_val], "x": [df50["일자"].iloc[-1]],
                                            "lbl": [f"평균 {avg_val/10000:.0f}만"]})).mark_text(
            align="right", dx=-4, dy=-8, color="#e03131", fontSize=10
        ).encode(x="x:T", y="avg:Q", text="lbl:N")

        chart50 = apply_theme(
            (bar50 + avg_rule + avg_text)
            .properties(width=460, height=260, background=CHART_BG)
        )
        st.altair_chart(chart50, use_container_width=True)
    else:
        st.info("데이터 없음")

# 월별/주차별 앱 가입현황
with ch_right:
    st.caption("월별/주차별 앱 가입현황")
    view_unit = st.radio("조회 단위", ["월별", "주차별"], horizontal=True, key="signup_unit")

    @st.cache_data(ttl=300)
    def get_signup(unit):
        if unit == "월별":
            sql = """
                SELECT TO_CHAR(CREATED_AT, 'YYYY-MM') AS "기간_str",
                       COALESCE(DEALER_TYPE, '미분류') AS "유형",
                       COUNT(*) AS "가입수"
                FROM AJDCAR_PROD.PUBLIC.USERS
                WHERE CREATED_AT IS NOT NULL AND NAME NOT LIKE '%테스트%'
                GROUP BY 1,2 ORDER BY 1
            """
        else:
            sql = """
                SELECT TO_CHAR(DATE_TRUNC('WEEK', CREATED_AT), 'YYYY-MM-DD') AS "기간_str",
                       COALESCE(DEALER_TYPE, '미분류') AS "유형",
                       COUNT(*) AS "가입수"
                FROM AJDCAR_PROD.PUBLIC.USERS
                WHERE CREATED_AT IS NOT NULL AND NAME NOT LIKE '%테스트%'
                GROUP BY 1,2 ORDER BY 1
            """
        df = session.sql(sql).to_pandas()
        df.columns = ["기간_str", "유형", "가입수"]
        return df

    df_sg = get_signup(view_unit)
    if not df_sg.empty:
        totals = df_sg.groupby("기간_str")["가입수"].sum().reset_index()
        totals.columns = ["기간_str", "합계"]

        bar_sg = alt.Chart(df_sg).mark_bar().encode(
            x=alt.X("기간_str:N", title="기간", sort=None,
                    axis=alt.Axis(labelAngle=-45)),
            y=alt.Y("가입수:Q", title="가입수", stack=True),
            color=alt.Color("유형:N", legend=alt.Legend(title="유형")),
            tooltip=[
                alt.Tooltip("기간_str:N", title="기간"),
                alt.Tooltip("유형:N", title="딜러유형"),
                alt.Tooltip("가입수:Q", title="가입수", format=",")
            ]
        )
        lbl_sg = alt.Chart(totals).mark_text(
            dy=-6, fontSize=11, fontWeight=600, color="#333333"
        ).encode(
            x=alt.X("기간_str:N", sort=None),
            y=alt.Y("합계:Q"),
            text=alt.Text("합계:Q", format=",")
        )
        chart_sg = apply_theme(
            (bar_sg + lbl_sg)
            .properties(width=460, height=260, background=CHART_BG)
        )
        st.altair_chart(chart_sg, use_container_width=True)
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
        GROUP BY 1,2 ORDER BY 1
    """).to_pandas()
    df.columns = ["기간", "채널", "원수보험료"]
    return df

df_ch = get_channel_premium(date_from, date_to, mgr_filter, ch_filter, period_unit)
if not df_ch.empty:
    totals_ch = df_ch.groupby("기간")["원수보험료"].sum().reset_index()
    totals_ch.columns = ["기간", "합계"]

    bar_ch = alt.Chart(df_ch).mark_bar().encode(
        x=alt.X("기간:N", sort=None, title="기간",
                axis=alt.Axis(labelAngle=-45)),
        y=alt.Y("원수보험료:Q", title="원수보험료(원)", axis=alt.Axis(format=",.0f")),
        color=alt.Color("채널:N", legend=alt.Legend(title="채널")),
        tooltip=[
            alt.Tooltip("기간:N"), alt.Tooltip("채널:N"),
            alt.Tooltip("원수보험료:Q", format=",.0f")
        ]
    )
    lbl_ch = alt.Chart(totals_ch).mark_text(dy=-6, fontSize=10, color="#333333").encode(
        x=alt.X("기간:N", sort=None),
        y=alt.Y("합계:Q"),
        text=alt.Text("합계:Q", format=",.0f")
    )
    chart_ch = apply_theme(
        (bar_ch + lbl_ch).properties(height=280, background=CHART_BG)
    )
    st.altair_chart(chart_ch, use_container_width=True)
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
            GROUP BY 1 ORDER BY 1
        """).to_pandas()
        df.columns = ["월", "가동딜러수"]
        return df

    df_adm = get_active_dealer_monthly(date_from, date_to, mgr_filter)
    if not df_adm.empty:
        c = apply_theme(
            alt.Chart(df_adm).mark_bar(color="#6a9fd8").encode(
                x=alt.X("월:N", sort=None, title=None, axis=alt.Axis(labelAngle=-30)),
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
                COALESCE(u.DEALER_TYPE, '미분류') AS "딜러유형",
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
              AND u.NAME NOT LIKE '%테스트%'
            GROUP BY 1 ORDER BY 2 DESC
        """).to_pandas()
        df.columns = ["딜러유형", "인당원수보험료"]
        return df

    df_pd = get_per_dealer(date_from, date_to)
    if not df_pd.empty:
        c = apply_theme(
            alt.Chart(df_pd).mark_bar(color="#f4a261").encode(
                y=alt.Y("딜러유형:N", sort="-x", title=None),
                x=alt.X("인당원수보험료:Q", title="인당 원수보험료(원)",
                        axis=alt.Axis(format=",.0f")),
                tooltip=[alt.Tooltip("딜러유형:N"),
                         alt.Tooltip("인당원수보험료:Q", format=",.0f")]
            ).properties(height=220, background=CHART_BG)
        )
        st.altair_chart(c, use_container_width=True)
    else:
        st.info("데이터 없음")

# ════════════════════════════════════
# 당월 보험사별 원수보험료/건수 (가로 막대)
# ════════════════════════════════════
st.markdown('<div class="section-title">당월 보험사별 현황</div>', unsafe_allow_html=True)

@st.cache_data(ttl=300)
def get_insurer_monthly():
    df = session.sql(f"""
        SELECT
            ca.INSURANCE_TYPE AS "보험사",
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
                x=alt.X("원수보험료:Q", title="원수보험료(원)",
                        axis=alt.Axis(format=",.0f")),
                tooltip=[alt.Tooltip("보험사:N"),
                         alt.Tooltip("원수보험료:Q", format=",.0f")]
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
            ca.INSURANCE_TYPE AS "보험사",
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
        GROUP BY 1,2,3 ORDER BY 1,2,3
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
    for c in pivot.columns[2:]:
        pivot[c] = pivot[c].apply(lambda x: f"{int(x):,}" if x else "-")
    st.dataframe(pivot, use_container_width=True, hide_index=True)
else:
    st.info("데이터 없음")

# ════════════════════════════════════
# 인입채널 빈 표
# ════════════════════════════════════
st.markdown('<div class="section-title">인입채널별 현황 (오프팀/상조회/B2B)</div>', unsafe_allow_html=True)
st.markdown('<div class="empty-box">데이터 준비중입니다</div>', unsafe_allow_html=True)
