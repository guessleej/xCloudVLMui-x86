"""event_service.py — 自動從 VisionSession 生成 FactoryEvent"""
import re
import uuid
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from models.db_models import FactoryEvent, VisionSession


async def auto_create_events(db: AsyncSession, session: VisionSession) -> list[FactoryEvent]:
    """
    當 VisionSession 儲存後，依據風險等級和偵測結果自動建立 FactoryEvent。
    只針對值得記錄的情況（critical/elevated risk, hazards detected, PPE violations）。
    """
    events = []

    # 1. 高風險事件（critical / elevated）
    if session.risk_level in ("critical", "elevated"):
        sev = "critical" if session.risk_level == "critical" else "high"
        title = f"{'🚨 緊急風險' if sev == 'critical' else '⚠️ 升高風險'}偵測"
        events.append(FactoryEvent(
            id=           str(uuid.uuid4()),
            event_type=   "detection",
            severity=     sev,
            title=        title,
            message=      _extract_summary(session.vlm_result or ""),
            source=       "vlm",
            session_id=   session.id,
            equipment_id= session.equipment_id,
            extra={
                "risk_level":    session.risk_level,
                "vhs_score":     session.vhs_score,
                "person_count":  session.person_count,
                "hazard_count":  session.hazard_count,
                "yolo_task":     session.yolo_task,
            },
            thumbnail=    session.thumbnail,
        ))

    # 2. 危害物品偵測
    if (session.hazard_count or 0) > 0:
        events.append(FactoryEvent(
            id=         str(uuid.uuid4()),
            event_type= "hazard",
            severity=   "high",
            title=      f"危害物品偵測 × {session.hazard_count}",
            message=    f"YOLO 偵測到 {session.hazard_count} 個危害物品，請立即確認現場安全。",
            source=     "yolo",
            session_id= session.id,
            extra={"hazard_count": session.hazard_count, "detections": session.detections},
            thumbnail=  session.thumbnail,
        ))

    # 3. PPE 違規（從 VLM 文字中解析）
    ppe_violations = _parse_ppe_violations(session.vlm_result or "")
    if ppe_violations:
        events.append(FactoryEvent(
            id=         str(uuid.uuid4()),
            event_type= "ppe_violation",
            severity=   "medium",
            title=      f"PPE 合規違規：{', '.join(ppe_violations)}",
            message=    f"偵測到人員未佩戴必要個人防護裝備：{', '.join(ppe_violations)}。",
            source=     "vlm",
            session_id= session.id,
            extra={"violations": ppe_violations, "person_count": session.person_count},
            thumbnail=  session.thumbnail,
        ))

    # 4. 設備 VHS 低分
    if session.vhs_score is not None and session.vhs_score < 50:
        sev = "critical" if session.vhs_score < 30 else "high"
        events.append(FactoryEvent(
            id=           str(uuid.uuid4()),
            event_type=   "equipment",
            severity=     sev,
            title=        f"設備健康警示：VHS {session.vhs_score}",
            message=      f"設備健康分數 {session.vhs_score}/100，{'立即停機檢修' if sev == 'critical' else '需要維護'}。",
            source=       "vlm",
            session_id=   session.id,
            equipment_id= session.equipment_id,
            extra={"vhs_score": session.vhs_score},
            thumbnail=    session.thumbnail,
        ))

    # 批量寫入
    for ev in events:
        db.add(ev)
    if events:
        await db.commit()
    return events


def _extract_summary(text: str) -> str:
    """從 VLM 輸出中取出最重要的一段（診斷摘要或前3行）"""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    # 取前3個有意義的行（跳過 DETECT:/ENV:/etc. 指令行）
    content = [l for l in lines if not re.match(r'^[A-Z_]+:', l)]
    return " ".join(content[:3])[:400] if content else text[:400]


def _parse_ppe_violations(text: str) -> list[str]:
    """從 VLM 輸出的 PPE: 行解析違規項目"""
    violations = []
    for line in text.splitlines():
        if line.strip().startswith("PPE:"):
            m = re.search(r'缺失項目=\[([^\]]+)\]', line)
            if m:
                items = [i.strip() for i in m.group(1).split('/') if i.strip() and i.strip() != "無"]
                violations.extend(items)
            # 也解析 "違規人數=[N]"（N>0 才記錄）
            if not violations:
                m2 = re.search(r'違規人數=\[?(\d+)\]?', line)
                if m2 and int(m2.group(1)) > 0:
                    violations.append(f"{m2.group(1)}人PPE違規")
    return violations
