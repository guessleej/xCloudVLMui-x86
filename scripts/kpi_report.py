#!/usr/bin/env python3
"""
scripts/kpi_report.py — xCloudVLMui Platform KPI 報告產生器
=============================================================
從 SQLite 資料庫直接讀取，產生設備健康 KPI 報告。
支援 JSON / CSV / 終端機表格 三種輸出格式。

使用方式：
  python scripts/kpi_report.py                        # 終端機表格（預設）
  python scripts/kpi_report.py --format json          # JSON
  python scripts/kpi_report.py --format csv           # CSV
  python scripts/kpi_report.py --format json --out /tmp/kpi.json
  python scripts/kpi_report.py --days 30              # 最近 30 天（預設 7）
  python scripts/kpi_report.py --db /data/xcloudvlm.db

KPI 指標清單：
  [1] 設備健康總覽   — 各設備最新 VHS 分數、狀態分布
  [2] 警報統計       — 總數 / 嚴重度分布 / 解決率
  [3] 維修報告活動   — 本期報告數 / 平均風險等級
  [4] MQTT 感測器品質 — 讀值數 / 錯誤率 / 上線率
  [5] RAG 知識庫狀態 — 文件數 / 嵌入率 / 向量段落數
  [6] 系統日誌摘要   — 錯誤率 / 最高頻動作

依賴（需與 backend 相同環境）：
  pip install aiosqlite
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import io
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    import aiosqlite
except ImportError:
    print("❌ 缺少依賴：pip install aiosqlite", file=sys.stderr)
    sys.exit(1)


# ── 預設路徑 ─────────────────────────────────────────────────────────
_DEFAULT_DB      = os.environ.get("DATABASE_PATH",  "./data/xcloudvlm.db")
_DEFAULT_SYSLOG  = os.environ.get("SYSLOG_PATH",    "./syslog.db")


# ── KPI 資料結構 ──────────────────────────────────────────────────────

class KpiReport:
    def __init__(self, days: int, generated_at: datetime) -> None:
        self.period_days   = days
        self.generated_at  = generated_at
        self.since         = generated_at - timedelta(days=days)
        self.equipment:    dict[str, Any] = {}
        self.alerts:       dict[str, Any] = {}
        self.reports:      dict[str, Any] = {}
        self.mqtt:         dict[str, Any] = {}
        self.rag:          dict[str, Any] = {}
        self.syslog:       dict[str, Any] = {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "meta": {
                "version":      "1.1.0",
                "platform":     "xCloudVLMui Platform",
                "generated_at": self.generated_at.isoformat(),
                "period_days":  self.period_days,
                "since":        self.since.isoformat(),
            },
            "equipment":  self.equipment,
            "alerts":     self.alerts,
            "reports":    self.reports,
            "mqtt":       self.mqtt,
            "rag":        self.rag,
            "syslog":     self.syslog,
        }


# ── 主資料庫 KPI 查詢 ─────────────────────────────────────────────────

async def _query_main_db(db_path: str, kpi: KpiReport) -> None:
    """從 xcloudvlm.db 取得所有 KPI 資料"""

    if not Path(db_path).exists():
        print(f"⚠️  主資料庫不存在：{db_path}（跳過相關 KPI）", file=sys.stderr)
        return

    async with aiosqlite.connect(db_path) as conn:
        conn.row_factory = aiosqlite.Row
        since_iso = kpi.since.strftime("%Y-%m-%d %H:%M:%S")

        # ── [1] Equipment VHS ──────────────────────────────────────
        # 取每台設備最新 VHS 分數（最近 N 天內有記錄）
        async with conn.execute("""
            SELECT
                equipment_id,
                ROUND(AVG(score), 1)     AS avg_score,
                ROUND(MIN(score), 1)     AS min_score,
                ROUND(MAX(score), 1)     AS max_score,
                COUNT(*)                 AS reading_count,
                MAX(recorded_at)         AS last_recorded
            FROM vhs_readings
            WHERE recorded_at >= ?
            GROUP BY equipment_id
            ORDER BY avg_score ASC
        """, (since_iso,)) as cur:
            rows = await cur.fetchall()

        vhs_list = [dict(r) for r in rows]
        # 分類健康等級
        def _vhs_status(s: float) -> str:
            if s < 40:   return "critical"
            if s < 60:   return "warning"
            if s < 80:   return "normal"
            return "good"

        kpi.equipment = {
            "vhs_by_equipment": [
                {**r, "status": _vhs_status(r["avg_score"])}
                for r in vhs_list
            ],
            "summary": {
                "total_equipment":  len(vhs_list),
                "critical_count":   sum(1 for r in vhs_list if r["avg_score"] < 40),
                "warning_count":    sum(1 for r in vhs_list if 40 <= r["avg_score"] < 60),
                "normal_count":     sum(1 for r in vhs_list if 60 <= r["avg_score"] < 80),
                "good_count":       sum(1 for r in vhs_list if r["avg_score"] >= 80),
                "overall_avg_vhs":  round(
                    sum(r["avg_score"] for r in vhs_list) / len(vhs_list), 1
                ) if vhs_list else None,
            },
        }

        # ── [2] Alerts ────────────────────────────────────────────
        async with conn.execute("""
            SELECT
                COUNT(*)                        AS total,
                SUM(CASE WHEN level='critical' THEN 1 ELSE 0 END) AS critical,
                SUM(CASE WHEN level='elevated' THEN 1 ELSE 0 END) AS elevated,
                SUM(CASE WHEN level='moderate' THEN 1 ELSE 0 END) AS moderate,
                SUM(CASE WHEN level='low'      THEN 1 ELSE 0 END) AS low,
                SUM(CASE WHEN resolved=1       THEN 1 ELSE 0 END) AS resolved,
                SUM(CASE WHEN resolved=0       THEN 1 ELSE 0 END) AS open
            FROM equipment_alerts
            WHERE created_at >= ?
        """, (since_iso,)) as cur:
            alert_row = dict(await cur.fetchone() or {})

        # 平均解決時間（僅已解決警報）
        async with conn.execute("""
            SELECT
                AVG(
                    CAST((JULIANDAY(resolved_at) - JULIANDAY(created_at)) * 1440 AS REAL)
                ) AS avg_resolve_min
            FROM equipment_alerts
            WHERE resolved=1 AND created_at >= ? AND resolved_at IS NOT NULL
        """, (since_iso,)) as cur:
            resolve_row = dict(await cur.fetchone() or {})

        total = alert_row.get("total") or 0
        resolved = alert_row.get("resolved") or 0
        kpi.alerts = {
            **alert_row,
            "resolve_rate_pct": round(resolved / total * 100, 1) if total else 0,
            "avg_resolve_min":  round(resolve_row.get("avg_resolve_min") or 0, 1),
        }

        # ── [3] Reports ───────────────────────────────────────────
        async with conn.execute("""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN risk_level='critical' THEN 1 ELSE 0 END) AS critical,
                SUM(CASE WHEN risk_level='high'     THEN 1 ELSE 0 END) AS high,
                SUM(CASE WHEN risk_level='moderate' THEN 1 ELSE 0 END) AS moderate,
                SUM(CASE WHEN risk_level='low'      THEN 1 ELSE 0 END) AS low,
                SUM(CASE WHEN source='vlm-diagnosis' THEN 1 ELSE 0 END) AS vlm_generated,
                SUM(CASE WHEN source='manual'        THEN 1 ELSE 0 END) AS manual
            FROM reports
            WHERE created_at >= ? AND is_deleted=0
        """, (since_iso,)) as cur:
            kpi.reports = dict(await cur.fetchone() or {})

        # ── [4] MQTT ──────────────────────────────────────────────
        async with conn.execute("""
            SELECT
                COUNT(DISTINCT device_id)                        AS active_devices,
                COUNT(*)                                         AS total_readings,
                SUM(CASE WHEN quality='good'  THEN 1 ELSE 0 END) AS good_readings,
                SUM(CASE WHEN quality='error' THEN 1 ELSE 0 END) AS error_readings,
                SUM(CASE WHEN quality='stale' THEN 1 ELSE 0 END) AS stale_readings,
                COUNT(DISTINCT sensor_type)                      AS sensor_types
            FROM mqtt_sensor_readings
            WHERE timestamp >= ?
        """, (since_iso,)) as cur:
            mqtt_row = dict(await cur.fetchone() or {})

        total_readings = mqtt_row.get("total_readings") or 0
        error_readings = mqtt_row.get("error_readings") or 0
        kpi.mqtt = {
            **mqtt_row,
            "error_rate_pct": round(error_readings / total_readings * 100, 2) if total_readings else 0,
        }

        # ── [5] RAG ───────────────────────────────────────────────
        async with conn.execute("""
            SELECT
                COUNT(*)                                       AS total_docs,
                SUM(CASE WHEN embedded=1 THEN 1 ELSE 0 END)   AS embedded_docs,
                SUM(chunk_count)                               AS total_chunks,
                SUM(file_size)                                 AS total_bytes
            FROM rag_documents
        """) as cur:
            rag_row = dict(await cur.fetchone() or {})

        total_docs   = rag_row.get("total_docs") or 0
        embedded_docs = rag_row.get("embedded_docs") or 0
        total_bytes  = rag_row.get("total_bytes") or 0
        kpi.rag = {
            **rag_row,
            "embed_rate_pct":  round(embedded_docs / total_docs * 100, 1) if total_docs else 0,
            "total_mb":        round(total_bytes / 1_048_576, 2) if total_bytes else 0,
        }


async def _query_syslog_db(syslog_path: str, kpi: KpiReport) -> None:
    """從 syslog.db 取得系統日誌 KPI"""

    if not Path(syslog_path).exists():
        print(f"⚠️  Syslog 資料庫不存在：{syslog_path}（跳過相關 KPI）", file=sys.stderr)
        return

    async with aiosqlite.connect(syslog_path) as conn:
        conn.row_factory = aiosqlite.Row
        since_iso = kpi.since.strftime("%Y-%m-%d %H:%M:%S")

        # 錯誤率統計
        async with conn.execute("""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN level='ERROR'    THEN 1 ELSE 0 END) AS errors,
                SUM(CASE WHEN level='WARNING'  THEN 1 ELSE 0 END) AS warnings,
                SUM(CASE WHEN level='CRITICAL' THEN 1 ELSE 0 END) AS criticals,
                ROUND(AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END), 1) AS avg_duration_ms
            FROM syslogs
            WHERE timestamp >= ?
        """, (since_iso,)) as cur:
            sys_row = dict(await cur.fetchone() or {})

        # 最高頻 action（Top 5）
        async with conn.execute("""
            SELECT action, COUNT(*) AS cnt
            FROM syslogs
            WHERE timestamp >= ?
            GROUP BY action
            ORDER BY cnt DESC
            LIMIT 5
        """, (since_iso,)) as cur:
            top_actions = [dict(r) for r in await cur.fetchall()]

        # 最近 3 筆 ERROR / CRITICAL
        async with conn.execute("""
            SELECT level, module, action, message, timestamp
            FROM syslogs
            WHERE level IN ('ERROR','CRITICAL') AND timestamp >= ?
            ORDER BY timestamp DESC
            LIMIT 3
        """, (since_iso,)) as cur:
            recent_errors = [dict(r) for r in await cur.fetchall()]

        total = sys_row.get("total") or 0
        errors = sys_row.get("errors") or 0
        kpi.syslog = {
            **sys_row,
            "error_rate_pct": round(errors / total * 100, 2) if total else 0,
            "top_actions":    top_actions,
            "recent_errors":  recent_errors,
        }


# ── 輸出格式 ──────────────────────────────────────────────────────────

def _render_table(kpi: KpiReport) -> str:
    """終端機表格輸出（ANSI 顏色）"""
    d = kpi.to_dict()
    m = d["meta"]
    lines: list[str] = []

    def section(title: str) -> None:
        lines.append(f"\n{'─' * 60}")
        lines.append(f"  {title}")
        lines.append(f"{'─' * 60}")

    def row(label: str, value: Any, unit: str = "") -> None:
        label_str = f"  {label:<30}"
        val_str   = f"{value}" if value is not None else "—"
        lines.append(f"{label_str}{val_str}{' ' + unit if unit else ''}")

    lines.append(f"\n{'═' * 60}")
    lines.append(f"  xCloudVLMui Platform KPI 報告  v{m['version']}")
    lines.append(f"  生成時間：{m['generated_at'][:19]}")
    lines.append(f"  統計期間：最近 {m['period_days']} 天（{m['since'][:10]} 起）")
    lines.append(f"{'═' * 60}")

    # Equipment
    section("📊 設備健康 VHS")
    eq = d["equipment"]
    if eq:
        s = eq.get("summary", {})
        row("設備總數",     s.get("total_equipment"))
        row("整體平均 VHS", s.get("overall_avg_vhs"), "分")
        row("嚴重（< 40）", s.get("critical_count"))
        row("警告（40–60）",s.get("warning_count"))
        row("正常（60–80）",s.get("normal_count"))
        row("良好（≥ 80）", s.get("good_count"))
        for item in eq.get("vhs_by_equipment", []):
            status_icon = {"critical": "🔴", "warning": "🟠", "normal": "🟡", "good": "🟢"}.get(item["status"], "⚪")
            lines.append(f"  {status_icon} {item['equipment_id']:<18} avg={item['avg_score']:5.1f}  "
                         f"min={item['min_score']:5.1f}  max={item['max_score']:5.1f}  "
                         f"readings={item['reading_count']}")

    # Alerts
    section("🚨 警報統計")
    al = d["alerts"]
    if al:
        row("本期警報總數",  al.get("total"))
        row("  Critical",   al.get("critical"))
        row("  Elevated",   al.get("elevated"))
        row("  Moderate",   al.get("moderate"))
        row("  Low",        al.get("low"))
        row("未解決",       al.get("open"))
        row("已解決",       al.get("resolved"))
        row("解決率",       al.get("resolve_rate_pct"), "%")
        row("平均解決時間", al.get("avg_resolve_min"), "分鐘")

    # Reports
    section("📋 維修報告")
    rp = d["reports"]
    if rp:
        row("本期報告總數",  rp.get("total"))
        row("  VLM 自動生成", rp.get("vlm_generated"))
        row("  人工建立",    rp.get("manual"))
        row("  Critical",    rp.get("critical"))
        row("  High",        rp.get("high"))
        row("  Moderate",    rp.get("moderate"))

    # MQTT
    section("📡 MQTT 感測器品質")
    mq = d["mqtt"]
    if mq:
        row("活躍設備數",   mq.get("active_devices"))
        row("感測器類型數", mq.get("sensor_types"))
        row("讀值總數",     mq.get("total_readings"))
        row("正常讀值",     mq.get("good_readings"))
        row("錯誤讀值",     mq.get("error_readings"))
        row("錯誤率",       mq.get("error_rate_pct"), "%")

    # RAG
    section("🧠 RAG 知識庫")
    rg = d["rag"]
    if rg:
        row("知識文件總數",  rg.get("total_docs"))
        row("已嵌入文件",   rg.get("embedded_docs"))
        row("嵌入率",       rg.get("embed_rate_pct"), "%")
        row("向量段落數",   rg.get("total_chunks"))
        row("知識庫大小",   rg.get("total_mb"), "MB")

    # Syslog
    section("📈 系統日誌摘要")
    sl = d["syslog"]
    if sl:
        row("日誌總筆數",   sl.get("total"))
        row("ERROR 數",     sl.get("errors"))
        row("WARNING 數",   sl.get("warnings"))
        row("CRITICAL 數",  sl.get("criticals"))
        row("錯誤率",       sl.get("error_rate_pct"), "%")
        row("平均 API 延遲", sl.get("avg_duration_ms"), "ms")
        top_acts = sl.get("top_actions", [])
        if top_acts:
            lines.append(f"\n  Top 5 動作：")
            for a in top_acts:
                lines.append(f"    {a['action']:<35} {a['cnt']:>5} 次")
        recent_errs = sl.get("recent_errors", [])
        if recent_errs:
            lines.append(f"\n  最近錯誤：")
            for e in recent_errs:
                lines.append(f"    [{e['level']}] {e['module']}.{e['action']}")
                lines.append(f"      {e['message'][:80]}")

    lines.append(f"\n{'═' * 60}\n")
    return "\n".join(lines)


def _render_csv(kpi: KpiReport) -> str:
    """CSV 輸出（扁平化 KPI 指標）"""
    d   = kpi.to_dict()
    buf = io.StringIO()
    w   = csv.writer(buf)
    now = d["meta"]["generated_at"][:19]

    w.writerow(["category", "metric", "value", "unit", "generated_at"])

    def write_rows(cat: str, data: dict, unit_map: dict | None = None) -> None:
        for k, v in data.items():
            if isinstance(v, (list, dict)):
                continue
            unit = (unit_map or {}).get(k, "")
            w.writerow([cat, k, v, unit, now])

    write_rows("equipment", kpi.equipment.get("summary", {}),
               {"overall_avg_vhs": "score"})
    write_rows("alerts",   kpi.alerts,
               {"resolve_rate_pct": "%", "avg_resolve_min": "min"})
    write_rows("reports",  kpi.reports)
    write_rows("mqtt",     kpi.mqtt, {"error_rate_pct": "%"})
    write_rows("rag",      kpi.rag, {"embed_rate_pct": "%", "total_mb": "MB"})
    write_rows("syslog",   kpi.syslog, {"error_rate_pct": "%", "avg_duration_ms": "ms"})

    # VHS by equipment
    for item in kpi.equipment.get("vhs_by_equipment", []):
        eid = item["equipment_id"]
        for metric in ["avg_score", "min_score", "max_score", "reading_count", "status"]:
            unit = "score" if "score" in metric else ""
            w.writerow([f"equipment.{eid}", metric, item.get(metric), unit, now])

    return buf.getvalue()


# ── 主程式 ────────────────────────────────────────────────────────────

async def _main(args: argparse.Namespace) -> None:
    now = datetime.now(timezone.utc)
    kpi = KpiReport(days=args.days, generated_at=now)

    print(f"📊 正在產生 KPI 報告（最近 {args.days} 天）...", file=sys.stderr)

    await asyncio.gather(
        _query_main_db(args.db, kpi),
        _query_syslog_db(args.syslog, kpi),
        return_exceptions=True,
    )

    # 輸出
    if args.format == "json":
        output = json.dumps(kpi.to_dict(), ensure_ascii=False, indent=2, default=str)
    elif args.format == "csv":
        output = _render_csv(kpi)
    else:
        output = _render_table(kpi)

    if args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"✅ 報告已儲存至：{args.out}", file=sys.stderr)
    else:
        print(output)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="xCloudVLMui Platform KPI 報告產生器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--db",
        default=_DEFAULT_DB,
        help=f"主資料庫路徑（預設：{_DEFAULT_DB}）")
    parser.add_argument("--syslog",
        default=_DEFAULT_SYSLOG,
        help=f"Syslog 資料庫路徑（預設：{_DEFAULT_SYSLOG}）")
    parser.add_argument("--days",
        type=int, default=7,
        help="統計天數（預設：7）")
    parser.add_argument("--format",
        choices=["table", "json", "csv"],
        default="table",
        help="輸出格式（預設：table）")
    parser.add_argument("--out",
        default=None,
        help="輸出至指定檔案（預設：stdout）")

    args = parser.parse_args()
    asyncio.run(_main(args))


if __name__ == "__main__":
    main()
