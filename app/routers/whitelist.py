import os
from datetime import timezone
from fastapi import APIRouter, Depends, Request, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from app.database import get_db
from app.models import WhitelistAddress, WhitelistState
from app.schemas import AddressIn, WhitelistResponse, WhitelistMeta, BulkWriteResponse, DeleteResponse, MerkleRootResponse, EntryIn, EntriesResponse, WhitelistEntry, SetMerkleRootIn
from app.merkle import build_merkle_tree
from app.auth import get_session_address
from app.rate_limit import limiter

router = APIRouter(prefix="/api/whitelist", tags=["whitelist"])

ADMIN_ADDRESS = os.environ.get("ADMIN_ADDRESS", "").lower()

def _require_admin(request: Request):
    addr = get_session_address(request)
    if not addr:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if addr.lower() != ADMIN_ADDRESS:
        raise HTTPException(status_code=403, detail="Forbidden")

async def _recalc_merkle(db: AsyncSession) -> str:
    # Flush any pending changes so the SELECT reads current data
    await db.flush()
    state = (await db.execute(select(WhitelistState).where(WhitelistState.id == 1))).scalar_one_or_none()
    # Respect manual override — admin-set roots survive whitelist edits until
    # the override is cleared via DELETE /api/whitelist/merkle-root.
    if state and state.manual_override:
        await db.commit()
        return state.merkle_root
    result = await db.execute(select(WhitelistAddress.address).order_by(WhitelistAddress.id))
    addresses = [row[0] for row in result.all()]
    root = build_merkle_tree(addresses)["root"] if addresses else "0x0"
    if state:
        state.merkle_root = root
        await db.flush()
        await db.refresh(state)
    else:
        db.add(WhitelistState(id=1, merkle_root=root))
    await db.commit()
    return root

@router.get("", response_model=WhitelistResponse)
@limiter.limit("100/minute")
async def get_whitelist(
    request: Request,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin),
):
    total_result = await db.execute(select(func.count()).select_from(WhitelistAddress))
    total = total_result.scalar()

    result = await db.execute(
        select(WhitelistAddress.address).order_by(WhitelistAddress.id).offset(offset).limit(limit)
    )
    addresses = [row[0] for row in result.all()]

    state = await db.get(WhitelistState, 1)
    return WhitelistResponse(
        addresses=addresses,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + limit < total,
        metadata=WhitelistMeta(
            merkle_root=state.merkle_root if state else "0x0",
            last_updated=state.last_updated.isoformat() if state else "",
            timestamp=int(__import__("time").time() * 1000),
            manual_override=bool(state.manual_override) if state else False,
        ),
    )

@router.post("", response_model=BulkWriteResponse)
@limiter.limit("10/minute")
async def bulk_write_whitelist(
    request: Request,
    body: AddressIn,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin),
):
    if body.action == "replace":
        await db.execute(delete(WhitelistAddress))
        await db.commit()

    existing_result = await db.execute(select(WhitelistAddress.address_lower))
    existing_set = {row[0] for row in existing_result.all()}

    to_add = [a for a in body.addresses if a.lower() not in existing_set]
    for addr in to_add:
        db.add(WhitelistAddress(address=addr, address_lower=addr.lower()))
    await db.commit()

    total_result = await db.execute(select(func.count()).select_from(WhitelistAddress))
    total = total_result.scalar()

    root = await _recalc_merkle(db)
    skipped = len(body.addresses) - len(to_add)
    return BulkWriteResponse(success=True, count=total, added=len(to_add), skipped=skipped, duplicates=skipped, merkle_root=root)

@router.post("/add", response_model=BulkWriteResponse)
@limiter.limit("10/minute")
async def add_addresses(
    request: Request,
    body: AddressIn,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin),
):
    body.action = "add"
    return await bulk_write_whitelist(request, body, db)


@router.post("/entry", response_model=BulkWriteResponse)
@limiter.limit("10/minute")
async def add_entry(
    request: Request,
    body: EntryIn,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin),
):
    """Add a single (address, name) entry. If the address already exists, the
    name is updated rather than duplicated."""
    existing = await db.execute(
        select(WhitelistAddress).where(WhitelistAddress.address_lower == body.address.lower())
    )
    row = existing.scalar_one_or_none()
    if row is None:
        db.add(WhitelistAddress(address=body.address, address_lower=body.address.lower(), name=body.name))
        added = 1
        skipped = 0
    else:
        # Address already on the list — only update the name if it was missing.
        if not row.name:
            row.name = body.name
        added = 0
        skipped = 1
    await db.commit()

    total_result = await db.execute(select(func.count()).select_from(WhitelistAddress))
    total = total_result.scalar()
    root = await _recalc_merkle(db)
    return BulkWriteResponse(
        success=True, count=total, added=added, skipped=skipped, duplicates=skipped, merkle_root=root
    )


@router.get("/entries", response_model=EntriesResponse)
@limiter.limit("100/minute")
async def get_entries(
    request: Request,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin),
):
    """Admin-only listing that includes name + added_at alongside the address."""
    total_result = await db.execute(select(func.count()).select_from(WhitelistAddress))
    total = total_result.scalar() or 0

    result = await db.execute(
        select(WhitelistAddress).order_by(WhitelistAddress.id).limit(limit).offset(offset)
    )
    rows = result.scalars().all()
    entries = [
        WhitelistEntry(
            address=r.address,
            name=r.name,
            added_at=r.added_at.isoformat() if r.added_at else None,
        )
        for r in rows
    ]

    state = (await db.execute(select(WhitelistState).where(WhitelistState.id == 1))).scalar_one_or_none()
    return EntriesResponse(
        entries=entries,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + limit < total,
        metadata=WhitelistMeta(
            merkle_root=state.merkle_root if state else "0x0",
            last_updated=state.last_updated.isoformat() if state else "",
            timestamp=int(__import__("time").time() * 1000),
            manual_override=bool(state.manual_override) if state else False,
        ),
    )

@router.delete("/{address}", response_model=DeleteResponse)
@limiter.limit("5/minute")
async def delete_address(
    address: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin),
):
    import re
    if not re.match(r"^0x[a-fA-F0-9]{40}$", address):
        raise HTTPException(status_code=400, detail="Invalid address format")

    result = await db.execute(
        select(WhitelistAddress).where(WhitelistAddress.address_lower == address.lower())
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Address not found")

    await db.delete(row)
    await db.commit()

    total_result = await db.execute(select(func.count()).select_from(WhitelistAddress))
    total = total_result.scalar()
    root = await _recalc_merkle(db)
    return DeleteResponse(success=True, count=total, removed=address, merkle_root=root)

@router.get("/export")
@limiter.limit("100/minute")
async def export_whitelist(
    request: Request,
    format: str = Query("json", regex="^(json|csv|txt)$"),
    include_merkle_root: bool = Query(True),
    db: AsyncSession = Depends(get_db),
):
    import json as json_mod
    from datetime import datetime
    result = await db.execute(select(WhitelistAddress.address).order_by(WhitelistAddress.id))
    addresses = [row[0] for row in result.all()]
    state = await db.get(WhitelistState, 1)
    date_str = datetime.now().strftime("%Y-%m-%d")

    if format == "csv":
        content = "address\n" + "\n".join(addresses)
        return Response(content=content, media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="whitelist-{date_str}.csv"'})
    elif format == "txt":
        content = "\n".join(addresses)
        return Response(content=content, media_type="text/plain",
                        headers={"Content-Disposition": f'attachment; filename="whitelist-{date_str}.txt"'})
    else:
        output = {"whitelist": addresses}
        if include_merkle_root:
            output["metadata"] = {
                "total": len(addresses),
                "merkle_root": state.merkle_root if state else None,
                "exported_at": datetime.now().isoformat(),
            }
        content = json_mod.dumps(output, indent=2)
        return Response(content=content, media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="whitelist-{date_str}.json"'})

@router.get("/merkle-root", response_model=MerkleRootResponse)
@limiter.limit("100/minute")
async def get_merkle_root(request: Request, db: AsyncSession = Depends(get_db)):
    state = await db.get(WhitelistState, 1)
    total_result = await db.execute(select(func.count()).select_from(WhitelistAddress))
    total = total_result.scalar()
    return MerkleRootResponse(
        root=state.merkle_root if state else "0x0",
        count=total,
        generated_at=state.last_updated.isoformat() if state else "",
        manual_override=bool(state.manual_override) if state else False,
    )

@router.put("/merkle-root", response_model=MerkleRootResponse)
@limiter.limit("10/minute")
async def set_merkle_root(
    request: Request,
    body: SetMerkleRootIn,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin),
):
    # Sets manual_override=true so subsequent whitelist edits do not overwrite
    # this value via _recalc_merkle. Clear with DELETE /api/whitelist/merkle-root.
    state = await db.get(WhitelistState, 1)
    if state:
        state.merkle_root = body.root
        state.manual_override = True
    else:
        db.add(WhitelistState(id=1, merkle_root=body.root, manual_override=True))
    await db.commit()
    state = await db.get(WhitelistState, 1)
    total = (await db.execute(select(func.count()).select_from(WhitelistAddress))).scalar()
    return MerkleRootResponse(
        root=state.merkle_root,
        count=total,
        generated_at=state.last_updated.isoformat() if state else "",
        manual_override=bool(state.manual_override) if state else False,
    )

@router.delete("/merkle-root", response_model=MerkleRootResponse)
@limiter.limit("10/minute")
async def clear_merkle_root_override(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_require_admin),
):
    # Clears manual_override and recalculates from the current whitelist.
    state = await db.get(WhitelistState, 1)
    if state:
        state.manual_override = False
    await db.commit()
    root = await _recalc_merkle(db)
    state = await db.get(WhitelistState, 1)
    total = (await db.execute(select(func.count()).select_from(WhitelistAddress))).scalar()
    return MerkleRootResponse(
        root=root,
        count=total,
        generated_at=state.last_updated.isoformat() if state else "",
        manual_override=bool(state.manual_override) if state else False,
    )

@router.post("/test")
@limiter.limit("10/minute")
async def test_address(request: Request, body: dict, db: AsyncSession = Depends(get_db)):
    import re
    from datetime import datetime
    address = body.get("address", "")
    if not re.match(r"^0x[a-fA-F0-9]{40}$", address):
        raise HTTPException(status_code=400, detail="Invalid address format")

    result = await db.execute(select(WhitelistAddress.address).order_by(WhitelistAddress.id))
    addresses = [row[0] for row in result.all()]

    if not addresses:
        return {"is_whitelisted": False, "address": address, "proof": [], "root": "0x0", "leaf_index": None, "generated_at": datetime.now().isoformat()}

    tree = build_merkle_tree(addresses)
    lower = address.lower()
    lower_list = [a.lower() for a in addresses]
    leaf_index = lower_list.index(lower) if lower in lower_list else None

    from app.merkle import get_proof
    proof = get_proof(tree, address) if leaf_index is not None else []

    return {"is_whitelisted": leaf_index is not None, "address": address, "proof": proof, "root": tree["root"], "leaf_index": leaf_index, "generated_at": datetime.now().isoformat()}
