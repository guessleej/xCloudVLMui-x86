"""
report_service.py — VLM JSON → Markdown 報告轉換 + CRUD
"""
from __future__ import annotations
import json
import uuid
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db_models import Report
from models.schemas import ReportCreate, ReportOut

logger = logging.getLogger(__name__)


# ── JSON → Markdown ────────────────────────────────────────────────────

def _risk_emoji(level: str) -> str:
    return {
        "critical": "🔴", "elevated": "🟠",
        "moderate": "🔵", "low":      "🟢",
    }.get(level, "⚪")


def vlm_json_to_markdown(vlm_json: dict[str, Any], equipment_name: str = "") -> str:
    """
    將 Gemma 4 E4B 輸出的異常診斷 JSON 轉為 Markdown 報告。
    支援 anomaly / pdm_thermal / pdm_lubrication / pdm_workorder 等結構。
    """
    lines: list[str] = []
    now   = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    scene = vlm_json.get("scene", "diagnosis")
    risk  = vlm_json.get("risk_level") or vlm_json.get("overall_risk_level") or "moderate"
    emoji = _risk_emoji(risk)

    lines += [
        f"# {equipment_name or '設備'} 維護診斷報告",
        "",
        f"**診斷時間**：{now}  ",
        f"**場景類型**：{scene}  ",
        f"**風險等級**：{emoji} {risk.upper()}  ",
        "",
        "---",
        "",
    ]

    # 異常現象
    if summary := vlm_json.get("anomaly_summary") or vlm_json.get("findings_summary"):
        lines += ["## 異常現象摘要", "", summary, ""]

    # 判斷依據
    if basis := vlm_json.get("judgment_basis"):
        lines += ["## 判斷依據", ""]
        if isinstance(basis, list):
            for b in basis:
                lines.append(f"- {b}")
        else:
            lines.append(str(basis))
        lines.append("")

    # 熱像 / 散熱
    if thermal := vlm_json.get("thermal_assessment"):
        lines += ["## 散熱評估", ""]
        if dust := thermal.get("dust_accumulation_mm"):
            lines.append(f"- 灰塵積厚估計：**{dust} mm**")
        if temp := thermal.get("temperature_rise_estimate_c"):
            lines.append(f"- 溫升估計：**{temp} °C**")
        if risk_t := thermal.get("thermal_risk"):
            lines.append(f"- 熱風險等級：{risk_t}")
        lines.append("")

    # 潤滑 / 密封
    if lub := vlm_json.get("lubrication_assessment"):
        lines += ["## 潤滑密封評估", ""]
        if stage := lub.get("seal_condition_stage"):
            lines.append(f"- 密封狀態：**{stage}**")
        if grease := lub.get("grease_condition"):
            lines.append(f"- 潤滑脂狀態：{grease}")
        if leak := lub.get("leakage_cm2_per_day"):
            lines.append(f"- 滲漏量估計：{leak} cm²/天")
        lines.append("")

    # 建議行動
    actions = vlm_json.get("recommended_actions") or vlm_json.get("work_items") or []
    if actions:
        lines += ["## 建議行動", ""]
        for act in actions:
            if isinstance(act, dict):
                priority = act.get("priority", "")
                desc     = act.get("description") or act.get("action") or str(act)
                deadline = act.get("deadline_days") or act.get("complete_within_days")
                line     = f"- **[{priority}]** {desc}"
                if deadline:
                    line += f"（建議 **{deadline} 天**內完成）"
                lines.append(line)
            else:
                lines.append(f"- {act}")
        lines.append("")

    # 備料清單
    materials = vlm_json.get("materials_required") or vlm_json.get("spare_parts") or []
    if materials:
        lines += ["## 備料清單", "", "| 料件 | 數量 | 備註 |", "|------|------|------|"]
        for m in materials:
            if isinstance(m, dict):
                name = m.get("name") or m.get("part_name") or str(m)
                qty  = m.get("quantity") or m.get("qty") or "1"
                note = m.get("note") or m.get("spec") or ""
                lines.append(f"| {name} | {qty} | {note} |")
            else:
                lines.append(f"| {m} | — | — |")
        lines.append("")

    # LINE 通知
    if line_msg := vlm_json.get("line_message"):
        lines += [
            "## LINE 通知訊息",
            "",
            "```",
            line_msg,
            "```",
            "",
        ]

    # 原始 JSON（折疊）
    lines += [
        "<details>",
        "<summary>原始 VLM JSON 輸出（展開）</summary>",
        "",
        "```json",
        json.dumps(vlm_json, ensure_ascii=False, indent=2),
        "```",
        "",
        "</details>",
    ]

    return "\n".join(lines)


# ── DB CRUD ────────────────────────────────────────────────────────────

async def create_report(
    db:   AsyncSession,
    data: ReportCreate,
    user_id: Optional[str] = None,
) -> Report:
    """建立報告，若有 raw_vlm_json 自動轉 Markdown"""
    report_id = str(uuid.uuid4())
    md = data.markdown_content

    if not md and data.raw_vlm_json:
        try:
            md = vlm_json_to_markdown(
                data.raw_vlm_json,
                equipment_name=data.equipment_name or "",
            )
        except Exception as e:
            logger.warning("MD conversion failed: %s", str(e))
            md = f"# {data.title}\n\n_報告轉換失敗：{e}_\n"

    report = Report(
        id=               report_id,
        user_id=          user_id,
        title=            data.title,
        equipment_id=     data.equipment_id,
        equipment_name=   data.equipment_name,
        risk_level=       data.risk_level,
        source=           data.source,
        raw_vlm_json=     data.raw_vlm_json,
        markdown_content= md,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return report


async def list_reports(
    db:           AsyncSession,
    user_id:      Optional[str] = None,
    equipment_id: Optional[str] = None,
    limit:        int = 50,
    offset:       int = 0,
) -> list[Report]:
    q = select(Report).where(Report.is_deleted == False)
    if user_id:
        q = q.where(Report.user_id == user_id)
    if equipment_id:
        q = q.where(Report.equipment_id == equipment_id)
    q = q.order_by(Report.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_report(db: AsyncSession, report_id: str) -> Optional[Report]:
    result = await db.execute(
        select(Report).where(Report.id == report_id, Report.is_deleted == False)
    )
    return result.scalar_one_or_none()


async def soft_delete_report(db: AsyncSession, report_id: str) -> bool:
    report = await get_report(db, report_id)
    if not report:
        return False
    report.is_deleted = True
    await db.commit()
    return True


def report_to_out(r: Report) -> ReportOut:
    return ReportOut(
        id=               r.id,
        title=            r.title,
        equipment_id=     r.equipment_id,
        equipment_name=   r.equipment_name,
        risk_level=       r.risk_level,
        source=           r.source,
        markdown_content= r.markdown_content,
        is_deleted=       r.is_deleted,
        created_at=       r.created_at.isoformat(),
        updated_at=       r.updated_at.isoformat(),
    )
