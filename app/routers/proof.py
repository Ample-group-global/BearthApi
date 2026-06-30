import re
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import WhitelistAddress, WhitelistState
from app.merkle import build_merkle_tree, get_proof
from app.schemas import ProofResponse
from app.rate_limit import limiter

router = APIRouter(prefix="/api/proof", tags=["proof"])

@router.get("", response_model=ProofResponse)
@limiter.limit("100/minute")
async def get_proof_endpoint(
    request: Request,
    address: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    if not re.match(r"^0x[a-fA-F0-9]{40}$", address):
        raise HTTPException(status_code=400, detail="Invalid or missing address parameter")

    result = await db.execute(select(WhitelistAddress.address).order_by(WhitelistAddress.id))
    addresses = [row[0] for row in result.all()]

    tree = build_merkle_tree(addresses)
    is_whitelisted = any(a.lower() == address.lower() for a in addresses)
    proof = get_proof(tree, address) if is_whitelisted else []

    return ProofResponse(proof=proof, root=tree["root"], is_whitelisted=is_whitelisted)
