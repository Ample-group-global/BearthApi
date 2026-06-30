"""add manual_override flag to whitelist_state

Revision ID: c3a5e1b9d201
Revises: b8c14d2f0a01
Create Date: 2026-05-07 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3a5e1b9d201"
down_revision: Union[str, None] = "b8c14d2f0a01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "whitelist_state",
        sa.Column("manual_override", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("whitelist_state", "manual_override")
