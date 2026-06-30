"""create whitelist tables

Revision ID: a714e534e284
Revises: 
Create Date: 2026-04-02 14:47:38.698013

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a714e534e284'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create whitelist_addresses table
    op.create_table(
        'whitelist_addresses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('address', sa.String(42), nullable=False),
        sa.Column('address_lower', sa.String(42), nullable=False),
        sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('address'),
        sa.UniqueConstraint('address_lower'),
    )
    op.create_index(op.f('ix_whitelist_addresses_address_lower'), 'whitelist_addresses', ['address_lower'], unique=False)

    # Create whitelist_state table
    op.create_table(
        'whitelist_state',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('merkle_root', sa.String(66), nullable=False, server_default='0x0'),
        sa.Column('last_updated', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    # Drop whitelist_state table
    op.drop_table('whitelist_state')

    # Drop whitelist_addresses table and its index
    op.drop_index(op.f('ix_whitelist_addresses_address_lower'), table_name='whitelist_addresses')
    op.drop_table('whitelist_addresses')
