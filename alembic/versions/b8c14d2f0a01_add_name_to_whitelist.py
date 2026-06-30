"""add name column to whitelist_addresses

Revision ID: b8c14d2f0a01
Revises: a714e534e284
Create Date: 2026-04-28 08:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b8c14d2f0a01"
down_revision: Union[str, None] = "a714e534e284"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "whitelist_addresses",
        sa.Column("name", sa.String(80), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("whitelist_addresses", "name")
