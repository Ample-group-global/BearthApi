import os
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from app.rate_limit import limiter
from app.routers import whitelist, proof, auth
from mangum import Mangum


def run_migrations():
    """Run Alembic migrations synchronously."""
    try:
        from alembic.config import Config
        from alembic.command import upgrade
        config = Config("alembic.ini")
        upgrade(config, "head")
        print("Migrations completed successfully")
    except Exception as e:
        print(f"Warning: Could not run migrations on startup: {e}")


async def recalc_merkle_root():
    """Recalculate merkle root from current whitelist on startup."""
    try:
        from app.database import async_session_factory
        from app.models import WhitelistAddress, WhitelistState
        from app.merkle import build_merkle_tree
        from sqlalchemy import select

        async with async_session_factory() as db:
            state = (await db.execute(select(WhitelistState).where(WhitelistState.id == 1))).scalar_one_or_none()
            if state and state.manual_override:
                print(f"Merkle root manual override active: {state.merkle_root[:18]}... (recalc skipped)")
                return
            result = await db.execute(select(WhitelistAddress.address).order_by(WhitelistAddress.id))
            addresses = [row[0] for row in result.all()]
            root = build_merkle_tree(addresses)["root"] if addresses else "0x0"
            if state:
                state.merkle_root = root
            else:
                db.add(WhitelistState(id=1, merkle_root=root))
            await db.commit()
            print(f"Merkle root recalculated: {root[:18]}... ({len(addresses)} addresses)")
    except Exception as e:
        print(f"Warning: Could not recalculate merkle root on startup: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup - run migrations in a thread pool
    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor() as executor:
        await loop.run_in_executor(executor, run_migrations)
    # Recalculate merkle root after migrations
    await recalc_merkle_root()
    yield
    # Shutdown


app = FastAPI(title="NFT Whitelist API", version="1.0.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

cors_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(whitelist.router)
app.include_router(proof.router)

@app.get("/api/health")
async def health():
    return {"status": "ok"}

# Vercel ASGI handler
handler = Mangum(app, lifespan="off")
