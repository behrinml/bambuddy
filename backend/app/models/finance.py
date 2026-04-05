from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.core.database import Base

if TYPE_CHECKING:
    from backend.app.models.archive import PrintArchive
    from backend.app.models.print_queue import PrintQueueItem
    from backend.app.models.user import User


class UserWallet(Base):
    """Per-user wallet balance.

    Balance updates are driven by wallet transactions.
    """

    __tablename__ = "user_wallets"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    balance: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    user: Mapped[User] = relationship()


class CostCenter(Base):
    """Cost center for assigning print costs and budgets."""

    __tablename__ = "cost_centers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_private: Mapped[bool] = mapped_column(Boolean, default=False)
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    total_budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    monthly_budget: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    owner: Mapped[User | None] = relationship()
    members: Mapped[list[CostCenterMember]] = relationship(
        "CostCenterMember",
        back_populates="cost_center",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class CostCenterMember(Base):
    """User-to-cost-center assignment with print permission."""

    __tablename__ = "cost_center_members"
    __table_args__ = (UniqueConstraint("cost_center_id", "user_id", name="uq_cost_center_members_cc_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    cost_center_id: Mapped[int] = mapped_column(ForeignKey("cost_centers.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    can_print: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    cost_center: Mapped[CostCenter] = relationship("CostCenter", back_populates="members")
    user: Mapped[User] = relationship()


class WalletTransaction(Base):
    """Immutable wallet ledger entry."""

    __tablename__ = "wallet_transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_centers.id", ondelete="SET NULL"), nullable=True, index=True
    )

    transaction_type: Mapped[str] = mapped_column(String(40), index=True)
    amount: Mapped[float] = mapped_column(Float)
    balance_after: Mapped[float | None] = mapped_column(Float, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    print_archive_id: Mapped[int | None] = mapped_column(
        ForeignKey("print_archives.id", ondelete="SET NULL"), nullable=True, index=True
    )
    print_queue_id: Mapped[int | None] = mapped_column(
        ForeignKey("print_queue.id", ondelete="SET NULL"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)

    user: Mapped[User] = relationship(foreign_keys=[user_id])
    cost_center: Mapped[CostCenter | None] = relationship()
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_user_id])
    print_archive: Mapped[PrintArchive | None] = relationship()
    print_queue: Mapped[PrintQueueItem | None] = relationship()
