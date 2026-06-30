"""
Standalone flow-check for merkle.py — no DB, no blockchain calls.
Run: python run_merkle_demo.py
"""
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)

from app.merkle import build_merkle_tree, get_proof

SAMPLE_ADDRESSES = [
    "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",  # Vitalik
    "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
]

PROBE_ADDRESS = SAMPLE_ADDRESSES[0]
ABSENT_ADDRESS = "0xDeAdBeEf00000000000000000000000000000000"

print("\n" + "=" * 70)
print("STEP 1 — Build Merkle tree")
print("=" * 70)
tree = build_merkle_tree(SAMPLE_ADDRESSES)

print("\n" + "=" * 70)
print(f"STEP 2 — Get proof for address IN the tree")
print(f"  address: {PROBE_ADDRESS}")
print("=" * 70)
proof = get_proof(tree, PROBE_ADDRESS)

print("\n" + "=" * 70)
print(f"STEP 3 — Get proof for address NOT in the tree")
print(f"  address: {ABSENT_ADDRESS}")
print("=" * 70)
empty_proof = get_proof(tree, ABSENT_ADDRESS)

print("\n" + "=" * 70)
print("SUMMARY")
print("=" * 70)
print(f"  Root           : {tree['root']}")
print(f"  Total layers   : {len(tree['layers'])}")
print(f"  Proof elements : {len(proof)}")
print(f"  Proof          : {proof}")
print(f"  Absent proof   : {empty_proof}  (expected [])")
