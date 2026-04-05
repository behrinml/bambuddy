from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.auth import RequirePermissionIfAuthEnabled
from backend.app.core.database import get_db
from backend.app.core.permissions import Permission
from backend.app.models.finance import CostCenter, CostCenterMember, UserWallet, WalletTransaction
from backend.app.models.user import User
from backend.app.schemas.finance import CostCenterSummaryResponse, WalletBalanceResponse, WalletTransactionResponse

router = APIRouter(prefix="/finance", tags=["finance"])


async def _require_authenticated_user(current_user: User | None) -> User:
    if current_user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return current_user


async def _get_or_create_wallet(db: AsyncSession, user_id: int) -> UserWallet:
    result = await db.execute(select(UserWallet).where(UserWallet.user_id == user_id))
    wallet = result.scalar_one_or_none()
    if wallet:
        return wallet

    wallet = UserWallet(user_id=user_id, balance=0.0, currency="EUR")
    db.add(wallet)
    await db.flush()
    return wallet


@router.get("/me/balance", response_model=WalletBalanceResponse)
async def get_my_balance(
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.FINANCE_READ_OWN),
):
    """Return the current user's wallet balance."""
    user = await _require_authenticated_user(current_user)
    wallet = await _get_or_create_wallet(db, user.id)
    return WalletBalanceResponse(
        user_id=user.id,
        balance=wallet.balance,
        currency=wallet.currency,
        updated_at=wallet.updated_at,
    )


@router.get("/me/transactions", response_model=list[WalletTransactionResponse])
async def get_my_transactions(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.FINANCE_READ_OWN),
):
    """Return wallet ledger entries for the current user."""
    user = await _require_authenticated_user(current_user)

    result = await db.execute(
        select(WalletTransaction)
        .where(WalletTransaction.user_id == user.id)
        .order_by(WalletTransaction.created_at.desc(), WalletTransaction.id.desc())
        .limit(limit)
        .offset(offset)
    )
    transactions = result.scalars().all()
    return [WalletTransactionResponse.model_validate(tx) for tx in transactions]


@router.get("/cost-centers/mine", response_model=list[CostCenterSummaryResponse])
async def get_my_cost_centers(
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.FINANCE_COST_CENTERS_READ),
):
    """Return private and assigned cost centers for the current user."""
    user = await _require_authenticated_user(current_user)

    result = await db.execute(
        select(CostCenter, CostCenterMember.can_print)
        .outerjoin(
            CostCenterMember,
            (CostCenterMember.cost_center_id == CostCenter.id) & (CostCenterMember.user_id == user.id),
        )
        .where(
            CostCenter.is_active.is_(True),
            or_(
                (CostCenter.is_private.is_(True) & (CostCenter.owner_user_id == user.id)),
                (CostCenterMember.user_id == user.id),
            ),
        )
        .order_by(CostCenter.is_private.desc(), CostCenter.name.asc())
    )

    centers: list[CostCenterSummaryResponse] = []
    for center, can_print in result.all():
        centers.append(
            CostCenterSummaryResponse(
                id=center.id,
                name=center.name,
                is_private=center.is_private,
                owner_user_id=center.owner_user_id,
                is_active=center.is_active,
                total_budget=center.total_budget,
                monthly_budget=center.monthly_budget,
                can_print=True if center.is_private and center.owner_user_id == user.id else bool(can_print),
            )
        )

    return centers
