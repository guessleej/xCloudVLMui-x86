"""event_schemas.py — FactoryEvent Pydantic schemas"""
from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class EventCreate(BaseModel):
    event_type:   str
    severity:     str
    title:        str
    message:      str
    source:       str = "manual"
    session_id:   Optional[str] = None
    equipment_id: Optional[str] = None
    location:     Optional[str] = None
    extra:        Optional[dict] = None
    thumbnail:    Optional[str] = None


class EventOut(BaseModel):
    id:           str
    event_type:   str
    severity:     str
    title:        str
    message:      str
    source:       str
    session_id:   Optional[str]  = None
    equipment_id: Optional[str]  = None
    location:     Optional[str]  = None
    extra:        Optional[dict] = None
    thumbnail:    Optional[str]  = None
    acknowledged: bool
    resolved:     bool
    resolved_at:  Optional[datetime] = None
    created_at:   datetime

    model_config = {"from_attributes": True}


class EventStats(BaseModel):
    total:           int
    unresolved:      int
    critical_24h:    int
    high_24h:        int
    by_type:         dict[str, int]
    by_severity:     dict[str, int]
