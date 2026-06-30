import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from dotenv import load_dotenv

load_dotenv()


def normalize_async_dsn(url: str) -> str:
    """Force the asyncpg driver.

    Managed Postgres providers (Railway, Heroku, etc.) inject DATABASE_URL as a
    bare ``postgres://`` or ``postgresql://`` URL, which SQLAlchemy maps to the
    default psycopg2 driver. We run an async engine, so rewrite the scheme to
    ``postgresql+asyncpg://`` unless a driver is already specified.
    """
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]
    return url


DATABASE_URL = normalize_async_dsn(os.environ["DATABASE_URL"])

engine = create_async_engine(DATABASE_URL, echo=False)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with async_session_factory() as session:
        yield session
