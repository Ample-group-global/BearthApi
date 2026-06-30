from typing import Literal
from pydantic import BaseModel, field_validator
import re

ETH_ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
MERKLE_ROOT_RE = re.compile(r"^0x[a-fA-F0-9]{64}$")

class AddressIn(BaseModel):
    addresses: list[str]
    action: Literal["add", "replace"] = "add"
    @field_validator("addresses")
    @classmethod
    def validate_addresses(cls, v):
        if not v:
            raise ValueError("addresses must be non-empty")
        if len(v) > 1000:
            raise ValueError("maximum 1000 addresses per request")
        invalid = [a for a in v if not ETH_ADDRESS_RE.match(a)]
        if invalid:
            raise ValueError(f"invalid addresses: {invalid}")
        return v

class WhitelistMeta(BaseModel):
    merkle_root: str
    last_updated: str
    timestamp: int
    manual_override: bool = False

class WhitelistResponse(BaseModel):
    addresses: list[str]
    total: int
    limit: int
    offset: int
    has_more: bool
    metadata: WhitelistMeta


class WhitelistEntry(BaseModel):
    address: str
    name: str | None = None
    added_at: str | None = None


class EntriesResponse(BaseModel):
    entries: list[WhitelistEntry]
    total: int
    limit: int
    offset: int
    has_more: bool
    metadata: WhitelistMeta


class EntryIn(BaseModel):
    address: str
    name: str

    @field_validator("address")
    @classmethod
    def validate_address(cls, v: str) -> str:
        if not ETH_ADDRESS_RE.match(v):
            raise ValueError("invalid address")
        return v

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1:
            raise ValueError("name must not be empty")
        if len(v) > 80:
            raise ValueError("name must be 80 chars or fewer")
        return v

class BulkWriteResponse(BaseModel):
    success: bool
    count: int
    added: int
    skipped: int
    duplicates: int
    merkle_root: str

class DeleteResponse(BaseModel):
    success: bool
    count: int
    removed: str
    merkle_root: str

class MerkleRootResponse(BaseModel):
    root: str
    count: int
    generated_at: str
    manual_override: bool = False

class SetMerkleRootIn(BaseModel):
    root: str

    @field_validator("root")
    @classmethod
    def validate_root(cls, v: str) -> str:
        if not MERKLE_ROOT_RE.match(v):
            raise ValueError("root must be a 0x-prefixed 32-byte hex string")
        return v

class ProofResponse(BaseModel):
    proof: list[str]
    root: str
    is_whitelisted: bool

class TestResponse(BaseModel):
    is_whitelisted: bool
    address: str
    proof: list[str]
    root: str
    leaf_index: int | None
    generated_at: str
