from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Boolean, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class WhitelistAddress(Base):
    __tablename__ = "whitelist_addresses"

    id: Mapped[int] = mapped_column(primary_key=True)
    address: Mapped[str] = mapped_column(String(42), unique=True, nullable=False)
    address_lower: Mapped[str] = mapped_column(String(42), unique=True, nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WhitelistState(Base):
    __tablename__ = "whitelist_state"
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    merkle_root: Mapped[str] = mapped_column(String(66), nullable=False, default="0x0")
    # When true, _recalc_merkle (triggered by whitelist add/delete/replace) will
    # NOT overwrite merkle_root. Cleared by DELETE /api/whitelist/merkle-root.
    manual_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    last_updated: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
