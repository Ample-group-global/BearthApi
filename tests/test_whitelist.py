import pytest
import time
from sqlalchemy import select
from app.models import WhitelistAddress, WhitelistState
from app.auth import create_session_token, verify_session_cookie


@pytest.mark.asyncio
async def test_whitelist_address_model(db):
    addr = WhitelistAddress(address="0xAbCd1234" + "0" * 32, address_lower="0xabcd1234" + "0" * 32)
    db.add(addr)
    await db.commit()
    result = await db.execute(select(WhitelistAddress))
    rows = result.scalars().all()
    assert len(rows) == 1
    assert rows[0].address_lower == "0xabcd1234" + "0" * 32


def test_round_trip_session(monkeypatch):
    monkeypatch.setenv("ADMIN_SECRET", "test-secret")
    token = create_session_token("0xabc")
    cookie = f"admin_session={token}"
    assert verify_session_cookie(cookie) == "0xabc"


def test_expired_session_returns_none(monkeypatch):
    monkeypatch.setenv("ADMIN_SECRET", "test-secret")
    import app.auth as auth_module
    original_ttl = auth_module.TTL_MS
    auth_module.TTL_MS = -1000  # already expired
    token = create_session_token("0xabc")
    auth_module.TTL_MS = original_ttl
    cookie = f"admin_session={token}"
    assert verify_session_cookie(cookie) is None


def test_tampered_token_returns_none(monkeypatch):
    monkeypatch.setenv("ADMIN_SECRET", "test-secret")
    token = create_session_token("0xabc") + "tampered"
    cookie = f"admin_session={token}"
    assert verify_session_cookie(cookie) is None


def test_set_merkle_root_schema_accepts_valid_hex32():
    from app.schemas import SetMerkleRootIn
    body = SetMerkleRootIn(root="0x" + "a" * 64)
    assert body.root == "0x" + "a" * 64


def test_set_merkle_root_schema_rejects_bad_format():
    import pytest as _pytest
    from pydantic import ValidationError
    from app.schemas import SetMerkleRootIn
    for bad in ["", "0x0", "0x" + "a" * 63, "0x" + "g" * 64, "a" * 64, "0x" + "a" * 65]:
        with _pytest.raises(ValidationError):
            SetMerkleRootIn(root=bad)


@pytest.mark.asyncio
async def test_set_merkle_root_persists_override(db):
    from app.models import WhitelistState
    db.add(WhitelistState(id=1, merkle_root="0x0"))
    await db.commit()

    override = "0x" + "1" * 64
    state = await db.get(WhitelistState, 1)
    state.merkle_root = override
    await db.commit()

    fresh = await db.get(WhitelistState, 1)
    assert fresh.merkle_root == override


@pytest.mark.asyncio
async def test_recalc_skips_when_manual_override_set(db):
    """_recalc_merkle must NOT overwrite the root when manual_override=True."""
    from app.models import WhitelistAddress, WhitelistState
    from app.routers.whitelist import _recalc_merkle

    overridden = "0x" + "a" * 64
    db.add(WhitelistState(id=1, merkle_root=overridden, manual_override=True))
    db.add(WhitelistAddress(
        address="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        address_lower="0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    ))
    await db.commit()

    returned = await _recalc_merkle(db)
    assert returned == overridden
    state = await db.get(WhitelistState, 1)
    assert state.merkle_root == overridden
    assert state.manual_override is True


@pytest.mark.asyncio
async def test_recalc_runs_when_override_cleared(db):
    """With manual_override=False, _recalc_merkle rebuilds from current addresses."""
    from app.models import WhitelistAddress, WhitelistState
    from app.routers.whitelist import _recalc_merkle
    from app.merkle import build_merkle_tree

    db.add(WhitelistState(id=1, merkle_root="0xstale", manual_override=False))
    addrs = [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    ]
    for a in addrs:
        db.add(WhitelistAddress(address=a, address_lower=a.lower()))
    await db.commit()

    expected_root = build_merkle_tree(addrs)["root"]
    returned = await _recalc_merkle(db)
    assert returned == expected_root
    state = await db.get(WhitelistState, 1)
    assert state.merkle_root == expected_root
    assert state.manual_override is False
