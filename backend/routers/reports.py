"""
routers/reports.py — 維護報告 CRUD
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.schemas import ReportCreate, ReportOut, VlmSessionCapture
from services.report_service import (
    create_report, list_reports, get_report,
    soft_delete_report, report_to_out,
)

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/", response_model=list[ReportOut])
async def get_reports(
    limit:        int         = 50,
    offset:       int         = 0,
    equipment_id: str | None  = None,
    db:           AsyncSession = Depends(get_db),
):
    reports = await list_reports(db, equipment_id=equipment_id, limit=limit, offset=offset)
    return [report_to_out(r) for r in reports]


@router.post("/", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
async def create_new_report(
    data: ReportCreate,
    db:   AsyncSession = Depends(get_db),
):
    report = await create_report(db, data)
    return report_to_out(report)


@router.get("/{report_id}", response_model=ReportOut)
async def get_single_report(
    report_id: str,
    db:        AsyncSession = Depends(get_db),
):
    report = await get_report(db, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report_to_out(report)


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_report(
    report_id: str,
    db:        AsyncSession = Depends(get_db),
):
    ok = await soft_delete_report(db, report_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Report not found")


@router.get("/{report_id}/download")
async def download_report_md(
    report_id: str,
    db:        AsyncSession = Depends(get_db),
):
    """下載 Markdown 原始文字（前端也可直接使用 /reports/{id} 的 markdown_content）"""
    from fastapi.responses import PlainTextResponse
    report = await get_report(db, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    raw_title = report.title or "report"
    ascii_title = "".join(c if (c.isascii() and (c.isalnum() or c in "-_")) else "_" for c in raw_title)
    safe_title = ascii_title.strip("_") or "report"
    import urllib.parse
    encoded_title = urllib.parse.quote(f"{raw_title}.md", safe="")
    return PlainTextResponse(
        content=report.markdown_content or "",
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=\"{safe_title}.md\"; filename*=UTF-8''{encoded_title}"},
    )


@router.post("/capture-vlm-session", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
async def capture_vlm_session(
    payload: VlmSessionCapture,
    db:      AsyncSession = Depends(get_db),
):
    """
    VLM WebUI 巡檢結束後前端觸發。
    若前端已提供 markdown_content 直接存入；否則以 raw_vlm_json 轉換。
    """
    data = ReportCreate(
        title=            payload.title or f"現場巡檢報告 — {payload.captured_at[:16]}",
        risk_level=       payload.risk_level or _infer_risk(payload.raw_vlm_json),
        source=           payload.source,
        markdown_content= payload.markdown_content,   # 直接使用（若有）
        raw_vlm_json=     payload.raw_vlm_json,
    )
    report = await create_report(db, data)
    return report_to_out(report)


def _infer_risk(vlm_json: dict | None) -> str:
    if not vlm_json:
        return "moderate"
    return (
        vlm_json.get("risk_level")
        or vlm_json.get("overall_risk_level")
        or "moderate"
    )
