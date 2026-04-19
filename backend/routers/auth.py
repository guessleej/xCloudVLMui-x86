"""
routers/auth.py — NextAuth callback 使用者同步
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import User
from models.schemas import UserUpsert, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/sync-user", response_model=UserOut)
async def sync_user(payload: UserUpsert, db: AsyncSession = Depends(get_db)):
    """
    NextAuth signIn callback 觸發，同步或建立使用者記錄。
    """
    result = await db.execute(select(User).where(User.id == payload.id))
    user   = result.scalar_one_or_none()

    if user:
        user.name          = payload.name
        user.email         = payload.email
        user.image         = payload.image
        user.provider      = payload.provider
        user.provider_id   = payload.provider_id
        user.last_login_at = datetime.now(timezone.utc)
    else:
        user = User(
            id=          payload.id,
            name=        payload.name,
            email=       payload.email,
            image=       payload.image,
            provider=    payload.provider,
            provider_id= payload.provider_id,
        )
        db.add(user)

    await db.commit()
    await db.refresh(user)
    return UserOut(
        id=         user.id,
        name=       user.name,
        email=      user.email,
        image=      user.image,
        provider=   user.provider,
        created_at= user.created_at.isoformat(),
    )
