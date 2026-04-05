from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.finance import CostCenter, CostCenterMember
from backend.app.models.user import User


async def get_private_cost_center_id(db: AsyncSession, user_id: int) -> int | None:
    """Return the private cost center id for a user, if available."""
    result = await db.execute(
        select(CostCenter.id).where(
            CostCenter.is_private.is_(True),
            CostCenter.owner_user_id == user_id,
            CostCenter.is_active.is_(True),
        )
    )
    return result.scalar_one_or_none()


async def resolve_print_cost_center_id(
    db: AsyncSession,
    user: User | None,
    requested_cost_center_id: int | None,
) -> int | None:
    """Resolve and validate a cost center for print attribution.

    Behavior:
    - Unauthenticated flow: pass through requested_cost_center_id.
    - Authenticated flow with no explicit request: use user's private cost center.
    - Private center: only owner may use it.
    - Shared center: user must be assigned with can_print=True.
    """
    if user is None:
        return requested_cost_center_id

    cost_center_id = requested_cost_center_id
    if cost_center_id is None:
        return await get_private_cost_center_id(db, user.id)

    center = await db.execute(select(CostCenter).where(CostCenter.id == cost_center_id))
    cc = center.scalar_one_or_none()
    if cc is None:
        raise HTTPException(status_code=400, detail="Cost center not found")
    if not cc.is_active:
        raise HTTPException(status_code=400, detail="Cost center is inactive")

    if cc.is_private:
        if cc.owner_user_id != user.id:
            raise HTTPException(status_code=403, detail="You cannot print to another user's private cost center")
        return cc.id

    membership_result = await db.execute(
        select(CostCenterMember).where(
            CostCenterMember.cost_center_id == cc.id,
            CostCenterMember.user_id == user.id,
        )
    )
    member = membership_result.scalar_one_or_none()
    if member is None or not member.can_print:
        raise HTTPException(status_code=403, detail="You are not allowed to print to this cost center")

    return cc.id
