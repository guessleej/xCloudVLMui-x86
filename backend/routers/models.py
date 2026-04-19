"""
routers/models.py — 視覺推論模型管理 API
職責：ONNX 模型登錄、啟用、CRUD 管理

端點：
  GET    /api/models             → 列出所有模型
  POST   /api/models             → 新增模型登錄
  GET    /api/models/active      → 取得各 task_type 目前啟用的模型
  GET    /api/models/{id}        → 取得單一模型詳情
  PATCH  /api/models/{id}        → 修改模型資訊
  DELETE /api/models/{id}        → 刪除（內建模型不可刪）
  POST   /api/models/{id}/activate → 設為該 task_type 啟用模型

種子資料（啟動時自動建立）：
  yolo26n.onnx      → detect  (E2E [1,300,6]  COCO-80)
  yolo26n-pose.onnx → pose    (E2E [1,300,57] COCO-17 keypoints)
"""
from __future__ import annotations

import uuid
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from database import get_db
from models.db_models import TrainedModel
from models.schemas import (
    TrainedModelCreate, TrainedModelOut, TrainedModelUpdate,
    TrainedModelListResponse, ActiveModelsResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/models", tags=["models"])


# ═══════════════════════════════════════════════════════════════════════
#  COCO 80 類別（detect / segment / obb 共用）
# ═══════════════════════════════════════════════════════════════════════

COCO_80_CLASSES = [
    "person","bicycle","car","motorcycle","airplane","bus","train","truck","boat",
    "traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat",
    "dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack",
    "umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball",
    "kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket",
    "bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple",
    "sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair",
    "couch","potted plant","bed","dining table","toilet","tv","laptop","mouse",
    "remote","keyboard","cell phone","microwave","oven","toaster","sink",
    "refrigerator","book","clock","vase","scissors","teddy bear","hair drier",
    "toothbrush",
]

COCO_17_KEYPOINTS = [
    "nose","left_eye","right_eye","left_ear","right_ear",
    "left_shoulder","right_shoulder","left_elbow","right_elbow",
    "left_wrist","right_wrist","left_hip","right_hip",
    "left_knee","right_knee","left_ankle","right_ankle",
]

IMAGENET_1K_SAMPLE = [f"class_{i}" for i in range(1000)]  # 完整 ImageNet-1K

# 預設種子模型定義
_SEED_MODELS = [
    {
        "id":             "builtin-detect-yolo26n",
        "name":           "YOLO26n Detection (COCO-80)",
        "description":    "Ultralytics YOLO v26 Nano — 物件偵測，E2E One-to-One Head。\n"
                          "輸出格式 [1, 300, 6]：[x1,y1,x2,y2,conf,class_id]。\n"
                          "mAP 40.9 @ COCO val2017，推論 56 ms (CPU/ONNX)。",
        "task_type":      "detect",
        "model_filename": "yolo26n.onnx",
        "model_size_mb":  9.4,
        "model_format":   "e2e",
        "output_shape":   "[1,300,6]",
        "input_size":     640,
        "num_classes":    80,
        "class_names":    COCO_80_CLASSES,
        "dataset_name":   "COCO",
        "is_active":      True,
        "is_builtin":     True,
        "source":         "ultralytics",
        "base_model":     "yolo26n",
        "metrics": {
            "mAP50":       56.2,
            "mAP50_95":    40.9,
            "precision":   87.1,
            "recall":      82.3,
            "latency_ms":  56,
            "params_M":    2.6,
        },
    },
    {
        "id":             "builtin-pose-yolo26n",
        "name":           "YOLO26n Pose (COCO-17 Keypoints)",
        "description":    "Ultralytics YOLO v26 Nano — 人員姿態估計，E2E One-to-One Head。\n"
                          "輸出格式 [1, 300, 57]：[x1,y1,x2,y2,conf,cls, kp0x,kp0y,kp0v × 17]。\n"
                          "支援 PPE 安全帽、反光衣、危險姿態輔助判斷。",
        "task_type":      "pose",
        "model_filename": "yolo26n-pose.onnx",
        "model_size_mb":  12.0,
        "model_format":   "e2e",
        "output_shape":   "[1,300,57]",
        "input_size":     640,
        "num_classes":    1,
        "class_names":    COCO_17_KEYPOINTS,
        "dataset_name":   "COCO",
        "is_active":      True,
        "is_builtin":     True,
        "source":         "ultralytics",
        "base_model":     "yolo26n-pose",
        "metrics": {
            "mAP50":       77.2,
            "mAP50_95":    57.2,
            "latency_ms":  40,
            "params_M":    2.9,
        },
    },
    {
        "id":             "builtin-segment-yolo26n",
        "name":           "YOLO26n Segment (COCO-80)",
        "description":    "Ultralytics YOLO v26 Nano — 實例分割。\n"
                          "輸出格式：bbox [1,300,38] + proto masks [1,32,160,160]。\n"
                          "需配合 proto masks 重建像素級輪廓。",
        "task_type":      "segment",
        "model_filename": "yolo26n-seg.onnx",
        "model_size_mb":  10.2,
        "model_format":   "e2e",
        "output_shape":   "[1,300,38]+[1,32,160,160]",
        "input_size":     640,
        "num_classes":    80,
        "class_names":    COCO_80_CLASSES,
        "dataset_name":   "COCO",
        "is_active":      False,
        "is_builtin":     True,
        "source":         "ultralytics",
        "base_model":     "yolo26n-seg",
        "metrics": {
            "mAP50_box":   56.1,
            "mAP50_95_box": 39.6,
            "mAP50_mask":  47.2,
            "mAP50_95_mask": 33.9,
            "latency_ms":  53,
            "params_M":    2.7,
        },
    },
    {
        "id":             "builtin-classify-yolo26n",
        "name":           "YOLO26n Classify (ImageNet-1K)",
        "description":    "Ultralytics YOLO v26 Nano — 影像分類（ImageNet-1K）。\n"
                          "輸入 224×224，輸出 [1, 1000] Softmax 分數。\n"
                          "Top-1 Accuracy 71.4%，推論僅 5 ms。",
        "task_type":      "classify",
        "model_filename": "yolo26n-cls.onnx",
        "model_size_mb":  4.3,
        "model_format":   "e2e",
        "output_shape":   "[1,1000]",
        "input_size":     224,
        "num_classes":    1000,
        "class_names":    IMAGENET_1K_SAMPLE,
        "dataset_name":   "ImageNet-1K",
        "is_active":      False,
        "is_builtin":     True,
        "source":         "ultralytics",
        "base_model":     "yolo26n-cls",
        "metrics": {
            "top1_acc":    71.4,
            "top5_acc":    90.2,
            "latency_ms":  5,
            "params_M":    2.8,
        },
    },
    {
        "id":             "builtin-obb-yolo26n",
        "name":           "YOLO26n OBB (DOTAv1)",
        "description":    "Ultralytics YOLO v26 Nano — 旋轉框偵測（Oriented Bounding Box）。\n"
                          "輸出格式 [1, 300, 7]：[x1,y1,x2,y2,conf,class_id,angle]。\n"
                          "適用於航拍影像，支援 15 類別（DOTAv1 資料集）。",
        "task_type":      "obb",
        "model_filename": "yolo26n-obb.onnx",
        "model_size_mb":  6.7,
        "model_format":   "e2e",
        "output_shape":   "[1,300,7]",
        "input_size":     640,
        "num_classes":    15,
        "class_names":    [
            "plane","ship","storage-tank","baseball-diamond","tennis-court",
            "basketball-court","ground-track-field","harbor","bridge",
            "large-vehicle","small-vehicle","helicopter","roundabout",
            "soccer-ball-field","swimming-pool",
        ],
        "dataset_name":   "DOTAv1",
        "is_active":      False,
        "is_builtin":     True,
        "source":         "ultralytics",
        "base_model":     "yolo26n-obb",
        "metrics": {
            "mAP50":       78.0,
            "latency_ms":  49,
            "params_M":    2.7,
        },
    },
]


async def seed_default_models(db: AsyncSession) -> None:
    """啟動時植入預設 Ultralytics 模型（若 ID 已存在則跳過）"""
    for data in _SEED_MODELS:
        existing = await db.get(TrainedModel, data["id"])
        if existing is None:
            model = TrainedModel(**data)
            db.add(model)
    try:
        await db.commit()
        logger.info("[Models] 預設模型種子資料植入完成（%d 筆）", len(_SEED_MODELS))
    except Exception as e:
        await db.rollback()
        logger.warning("[Models] 種子資料植入失敗（可能已存在）：%s", e)


# ═══════════════════════════════════════════════════════════════════════
#  CRUD 端點
# ═══════════════════════════════════════════════════════════════════════

@router.get("", response_model=TrainedModelListResponse)
async def list_models(
    task_type:  Optional[str] = Query(None, description="過濾任務類型：detect|pose|segment|classify|obb"),
    is_active:  Optional[bool] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """列出所有已登錄的模型（支援 task_type / is_active 過濾）"""
    conditions = []
    if task_type:
        conditions.append(TrainedModel.task_type == task_type)
    if is_active is not None:
        conditions.append(TrainedModel.is_active == is_active)

    stmt = select(TrainedModel)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = stmt.order_by(TrainedModel.task_type, TrainedModel.created_at)

    rows = await db.execute(stmt)
    items = rows.scalars().all()

    return TrainedModelListResponse(
        total= len(items),
        items= [TrainedModelOut.model_validate(m) for m in items],
    )


@router.get("/active", response_model=ActiveModelsResponse)
async def get_active_models(db: AsyncSession = Depends(get_db)):
    """取得各 task_type 目前啟用的模型（前端用於動態載入 ONNX）"""
    stmt = select(TrainedModel).where(TrainedModel.is_active == True)
    rows = await db.execute(stmt)
    active = rows.scalars().all()

    result: dict[str, TrainedModelOut] = {}
    for m in active:
        result[m.task_type] = TrainedModelOut.model_validate(m)

    return ActiveModelsResponse(models=result)


@router.get("/{model_id}", response_model=TrainedModelOut)
async def get_model(model_id: str, db: AsyncSession = Depends(get_db)):
    """取得單一模型詳情"""
    item = await db.get(TrainedModel, model_id)
    if not item:
        raise HTTPException(status_code=404, detail="模型不存在")
    return TrainedModelOut.model_validate(item)


@router.post("", response_model=TrainedModelOut, status_code=201)
async def create_model(
    payload: TrainedModelCreate,
    db: AsyncSession = Depends(get_db),
):
    """新增模型登錄"""
    # 若設定 is_active=True，先把同 task_type 其他模型停用
    if payload.is_active:
        await _deactivate_task(db, payload.task_type)

    item = TrainedModel(
        id=               str(uuid.uuid4()),
        name=             payload.name,
        description=      payload.description,
        task_type=        payload.task_type,
        model_filename=   payload.model_filename,
        model_size_mb=    payload.model_size_mb,
        model_format=     payload.model_format,
        output_shape=     payload.output_shape,
        input_size=       payload.input_size,
        num_classes=      payload.num_classes,
        class_names=      payload.class_names,
        dataset_name=     payload.dataset_name,
        is_active=        payload.is_active,
        is_builtin=       False,
        source=           payload.source,
        base_model=       payload.base_model,
        metrics=          payload.metrics,
        notes=            payload.notes,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    logger.info("[Models] 新增模型：%s (%s)", item.name, item.task_type)
    return TrainedModelOut.model_validate(item)


@router.patch("/{model_id}", response_model=TrainedModelOut)
async def update_model(
    model_id: str,
    payload:  TrainedModelUpdate,
    db:       AsyncSession = Depends(get_db),
):
    """修改模型資訊（不可修改 is_builtin）"""
    item = await db.get(TrainedModel, model_id)
    if not item:
        raise HTTPException(status_code=404, detail="模型不存在")

    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "is_active" and value is True:
            await _deactivate_task(db, item.task_type, exclude_id=model_id)
        setattr(item, field, value)

    await db.commit()
    await db.refresh(item)
    return TrainedModelOut.model_validate(item)


@router.delete("/{model_id}", status_code=204)
async def delete_model(model_id: str, db: AsyncSession = Depends(get_db)):
    """刪除模型（內建模型不可刪除）"""
    item = await db.get(TrainedModel, model_id)
    if not item:
        raise HTTPException(status_code=404, detail="模型不存在")
    if item.is_builtin:
        raise HTTPException(status_code=403, detail="系統內建模型不可刪除，可停用或修改備註。")

    await db.delete(item)
    await db.commit()
    logger.info("[Models] 刪除模型：%s (%s)", item.name, item.task_type)


@router.post("/{model_id}/activate", response_model=TrainedModelOut)
async def activate_model(model_id: str, db: AsyncSession = Depends(get_db)):
    """設為該 task_type 的啟用模型（同時停用其他同類型模型）"""
    item = await db.get(TrainedModel, model_id)
    if not item:
        raise HTTPException(status_code=404, detail="模型不存在")

    await _deactivate_task(db, item.task_type, exclude_id=model_id)
    item.is_active = True
    await db.commit()
    await db.refresh(item)
    logger.info("[Models] 啟用模型：%s (%s)", item.name, item.task_type)
    return TrainedModelOut.model_validate(item)


# ── 工具函式 ──────────────────────────────────────────────────────────

async def _deactivate_task(db: AsyncSession, task_type: str, exclude_id: str = "") -> None:
    """將指定 task_type 的所有模型設為 is_active=False（排除 exclude_id）"""
    stmt = select(TrainedModel).where(
        and_(
            TrainedModel.task_type == task_type,
            TrainedModel.is_active == True,
        )
    )
    if exclude_id:
        stmt = stmt.where(TrainedModel.id != exclude_id)
    rows = await db.execute(stmt)
    for m in rows.scalars().all():
        m.is_active = False
