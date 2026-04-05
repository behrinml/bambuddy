from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.core.auth import RequirePermissionIfAuthEnabled
from backend.app.core.database import get_db
from backend.app.core.permissions import Permission
from backend.app.models.finance import CostCenter, CostCenterMember, UserWallet, WalletTransaction
from backend.app.models.user import User
from backend.app.schemas.finance import (
    CostCenterBudgetUpdateRequest,
    CostCenterCreateRequest,
    CostCenterDetailResponse,
    CostCenterMemberRequest,
    CostCenterMemberResponse,
    CostCenterSummaryResponse,
    CostCenterUpdateRequest,
    WalletAdjustmentRequest,
    WalletAdjustmentResponse,
    WalletBalanceResponse,
    WalletTransactionResponse,
)

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


async def _get_user_or_404(db: AsyncSession, user_id: int) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


async def _get_cost_center_or_404(db: AsyncSession, cost_center_id: int) -> CostCenter:
    result = await db.execute(
        select(CostCenter).options(selectinload(CostCenter.members)).where(CostCenter.id == cost_center_id)
    )
    center = result.scalar_one_or_none()
    if center is None:
        raise HTTPException(status_code=404, detail="Cost center not found")
    return center


def _to_balance_response(wallet: UserWallet) -> WalletBalanceResponse:
    return WalletBalanceResponse(
        user_id=wallet.user_id,
        balance=wallet.balance,
        currency=wallet.currency,
        updated_at=wallet.updated_at,
    )


async def _create_wallet_adjustment(
    db: AsyncSession,
    *,
    target_user_id: int,
    actor_user_id: int,
    amount: float,
    transaction_type: str,
    description: str | None,
    cost_center_id: int | None,
) -> WalletAdjustmentResponse:
    if cost_center_id is not None:
        await _get_cost_center_or_404(db, cost_center_id)

    wallet = await _get_or_create_wallet(db, target_user_id)

    new_balance = wallet.balance + amount
    if new_balance < 0:
        raise HTTPException(status_code=400, detail="Insufficient balance for withdrawal")

    wallet.balance = new_balance
    tx = WalletTransaction(
        user_id=target_user_id,
        cost_center_id=cost_center_id,
        transaction_type=transaction_type,
        amount=amount,
        balance_after=new_balance,
        description=description,
        created_by_user_id=actor_user_id,
    )
    db.add(tx)
    await db.flush()

    return WalletAdjustmentResponse(
        transaction=WalletTransactionResponse.model_validate(tx),
        balance=_to_balance_response(wallet),
    )


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


@router.get("/users/{user_id}/balance", response_model=WalletBalanceResponse)
async def get_user_balance(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.FINANCE_READ_ALL),
):
    """Return a specific user's wallet balance."""
    await _require_authenticated_user(current_user)
    user = await _get_user_or_404(db, user_id)
    wallet = await _get_or_create_wallet(db, user.id)
    return _to_balance_response(wallet)


@router.get("/users/{user_id}/transactions", response_model=list[WalletTransactionResponse])
async def get_user_transactions(
    user_id: int,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.FINANCE_READ_ALL),
):
    """Return wallet ledger entries for a specific user."""
    await _require_authenticated_user(current_user)
    await _get_user_or_404(db, user_id)

    result = await db.execute(
        select(WalletTransaction)
        .where(WalletTransaction.user_id == user_id)
        .order_by(WalletTransaction.created_at.desc(), WalletTransaction.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return [WalletTransactionResponse.model_validate(tx) for tx in result.scalars().all()]


@router.post("/users/{user_id}/deposit", response_model=WalletAdjustmentResponse)
async def deposit_user_balance(
    user_id: int,
    body: WalletAdjustmentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.FINANCE_TRANSACTIONS_CREATE),
):
    """Add funds to a user's wallet."""
    actor = await _require_authenticated_user(current_user)
    await _get_user_or_404(db, user_id)
    return await _create_wallet_adjustment(
        db,
        target_user_id=user_id,
        actor_user_id=actor.id,
        amount=body.amount,
        transaction_type="deposit",
        description=body.description,
        cost_center_id=body.cost_center_id,
    )


@router.post("/users/{user_id}/withdraw", response_model=WalletAdjustmentResponse)
async def withdraw_user_balance(
    user_id: int,
    body: WalletAdjustmentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.FINANCE_TRANSACTIONS_CREATE),
):
    """Withdraw funds from a user's wallet."""
    actor = await _require_authenticated_user(current_user)
    await _get_user_or_404(db, user_id)
    return await _create_wallet_adjustment(
        db,
        target_user_id=user_id,
        actor_user_id=actor.id,
        amount=-body.amount,
        transaction_type="withdraw",
        description=body.description,
        cost_center_id=body.cost_center_id,
    )


@router.get("/cost-centers", response_model=list[CostCenterSummaryResponse])
async def list_cost_centers(
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.FINANCE_COST_CENTERS_READ),
):
    """List all cost centers.

    Requires finance:cost_centers:read.
    """
    await _require_authenticated_user(current_user)
    query = select(CostCenter).order_by(CostCenter.is_private.desc(), CostCenter.name.asc())
    if not include_inactive:
        query = query.where(CostCenter.is_active.is_(True))

    result = await db.execute(query)
    centers = result.scalars().all()
    return [
        CostCenterSummaryResponse(
            id=center.id,
            name=center.name,
            is_private=center.is_private,
            owner_user_id=center.owner_user_id,
            is_active=center.is_active,
            total_budget=center.total_budget,
            monthly_budget=center.monthly_budget,
            can_print=True,
        )
        for center in centers
    ]


@router.post("/cost-centers", response_model=CostCenterSummaryResponse)
async def create_cost_center(
    body: CostCenterCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.FINANCE_COST_CENTERS_CREATE),
):
    """Create a shared cost center."""
    await _require_authenticated_user(current_user)
    center = CostCenter(
        name=body.name.strip(),
        is_active=body.is_active,
        is_private=False,
        owner_user_id=None,
        total_budget=body.total_budget,
        monthly_budget=body.monthly_budget,
    )
    db.add(center)
    await db.flush()

    return CostCenterSummaryResponse(
        id=center.id,
        name=center.name,
        is_private=center.is_private,
        owner_user_id=center.owner_user_id,
        is_active=center.is_active,
        total_budget=center.total_budget,
        monthly_budget=center.monthly_budget,
        can_print=True,
    )


@router.get("/cost-centers/{cost_center_id}", response_model=CostCenterDetailResponse)
async def get_cost_center(
    cost_center_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.FINANCE_COST_CENTERS_READ),
):
    """Get one cost center with its memberships."""
    await _require_authenticated_user(current_user)
    center = await _get_cost_center_or_404(db, cost_center_id)
    return CostCenterDetailResponse(
        id=center.id,
        name=center.name,
        is_private=center.is_private,
        owner_user_id=center.owner_user_id,
        is_active=center.is_active,
        total_budget=center.total_budget,
        monthly_budget=center.monthly_budget,
        can_print=True,
        members=[CostCenterMemberResponse.model_validate(m) for m in center.members],
    )


@router.patch("/cost-centers/{cost_center_id}", response_model=CostCenterSummaryResponse)
async def update_cost_center(
    cost_center_id: int,
    body: CostCenterUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.FINANCE_COST_CENTERS_UPDATE),
):
    """Update name or active-state of a cost center."""
    await _require_authenticated_user(current_user)
    center = await _get_cost_center_or_404(db, cost_center_id)

    if body.name is not None:
        center.name = body.name.strip()
    if body.is_active is not None:
        center.is_active = body.is_active

    await db.flush()

    return CostCenterSummaryResponse(
        id=center.id,
        name=center.name,
        is_private=center.is_private,
        owner_user_id=center.owner_user_id,
        is_active=center.is_active,
        total_budget=center.total_budget,
        monthly_budget=center.monthly_budget,
        can_print=True,
    )


@router.patch("/cost-centers/{cost_center_id}/budgets", response_model=CostCenterSummaryResponse)
async def update_cost_center_budgets(
    cost_center_id: int,
    body: CostCenterBudgetUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.FINANCE_BUDGETS_UPDATE),
):
    """Update budget values of a cost center."""
    await _require_authenticated_user(current_user)
    center = await _get_cost_center_or_404(db, cost_center_id)

    center.total_budget = body.total_budget
    center.monthly_budget = body.monthly_budget
    await db.flush()

    return CostCenterSummaryResponse(
        id=center.id,
        name=center.name,
        is_private=center.is_private,
        owner_user_id=center.owner_user_id,
        is_active=center.is_active,
        total_budget=center.total_budget,
        monthly_budget=center.monthly_budget,
        can_print=True,
    )


@router.post("/cost-centers/{cost_center_id}/members", response_model=CostCenterMemberResponse)
async def upsert_cost_center_member(
    cost_center_id: int,
    body: CostCenterMemberRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.FINANCE_COST_CENTERS_ASSIGN_USERS),
):
    """Assign or update a user's membership on a cost center."""
    await _require_authenticated_user(current_user)
    center = await _get_cost_center_or_404(db, cost_center_id)

    if center.is_private:
        raise HTTPException(status_code=400, detail="Private cost center memberships cannot be modified")

    await _get_user_or_404(db, body.user_id)

    existing = await db.execute(
        select(CostCenterMember).where(
            CostCenterMember.cost_center_id == cost_center_id,
            CostCenterMember.user_id == body.user_id,
        )
    )
    member = existing.scalar_one_or_none()
    if member is None:
        member = CostCenterMember(cost_center_id=cost_center_id, user_id=body.user_id, can_print=body.can_print)
        db.add(member)
    else:
        member.can_print = body.can_print

    await db.flush()
    return CostCenterMemberResponse.model_validate(member)


@router.delete("/cost-centers/{cost_center_id}/members/{user_id}")
async def remove_cost_center_member(
    cost_center_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.FINANCE_COST_CENTERS_ASSIGN_USERS),
):
    """Remove a user from a shared cost center."""
    await _require_authenticated_user(current_user)
    center = await _get_cost_center_or_404(db, cost_center_id)
    if center.is_private:
        raise HTTPException(status_code=400, detail="Private cost center memberships cannot be modified")

    result = await db.execute(
        select(CostCenterMember).where(
            CostCenterMember.cost_center_id == cost_center_id,
            CostCenterMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Membership not found")

    await db.delete(member)
    return {"status": "success"}
