from datetime import datetime

from pydantic import BaseModel


class WalletBalanceResponse(BaseModel):
    user_id: int
    balance: float
    currency: str
    updated_at: datetime | None = None


class WalletTransactionResponse(BaseModel):
    id: int
    user_id: int
    cost_center_id: int | None = None
    transaction_type: str
    amount: float
    balance_after: float | None = None
    description: str | None = None
    created_by_user_id: int | None = None
    print_archive_id: int | None = None
    print_queue_id: int | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class CostCenterSummaryResponse(BaseModel):
    id: int
    name: str
    is_private: bool
    owner_user_id: int | None = None
    is_active: bool
    total_budget: float | None = None
    monthly_budget: float | None = None
    can_print: bool = True

    class Config:
        from_attributes = True
