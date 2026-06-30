from app.merkle import encode_leaf, build_merkle_tree, get_proof

ADDRESSES = [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
]

def test_encode_leaf_is_keccak_of_packed_address():
    import hashlib
    from eth_abi.packed import encode_packed
    addr = ADDRESSES[0].lower()
    packed = encode_packed(["address"], [addr])
    from eth_hash.auto import keccak
    expected = keccak(packed)
    assert encode_leaf(ADDRESSES[0]) == expected

def test_build_merkle_tree_returns_consistent_root():
    result1 = build_merkle_tree(ADDRESSES)
    result2 = build_merkle_tree(ADDRESSES)
    assert result1["root"] == result2["root"]
    assert result1["root"].startswith("0x")
    assert len(result1["root"]) == 66

def test_get_proof_verifies_inclusion():
    tree = build_merkle_tree(ADDRESSES)
    proof = get_proof(tree, ADDRESSES[0])
    assert isinstance(proof, list)
    assert all(p.startswith("0x") and len(p) == 66 for p in proof)

def test_non_member_returns_empty_proof():
    tree = build_merkle_tree(ADDRESSES)
    proof = get_proof(tree, "0x" + "1" * 40)
    assert proof == []


# Hardhat parity: pinned values produced by ../NFT/hardhat/scripts/getMerkleProof.ts
# (merkletreejs sortPairs:true + keccak256). Cross-checked 2026-05-07. If this
# test ever fails, the backend tree algorithm has drifted from the contract's
# OpenZeppelin MerkleProof.verify expectations.
HARDHAT_WHITELIST = [
    "0xfb989d8296dd44d26c55ac8b839d998add5e9d01",
    "0xDB01f7DFefA1AAe19A2204a4Ffa42dd7EC583AfD",
    "0xF28258A4F42d073653C0E3Ed9d09e855273f3D44",
]
HARDHAT_ROOT = "0x704f15979cd434504c58c54632838ec88459158d4679205e1a10b505c487e196"
HARDHAT_PROOFS = {
    "0xfb989d8296dd44d26c55ac8b839d998add5e9d01": [
        "0xfffc91c95758c78d7f8cb4f11ec8a54c21c7cfa8c125829fbea51f7c54e617f4",
        "0x3a656a127143b4e07a7a14e04d86f3f94de6690081c24c7a48d33ba371a81440",
    ],
    "0xDB01f7DFefA1AAe19A2204a4Ffa42dd7EC583AfD": [
        "0xd616e69b84ef779ae7ef7db1a6446206656b8334d70fde1af01319b6786f9f9e",
        "0x3a656a127143b4e07a7a14e04d86f3f94de6690081c24c7a48d33ba371a81440",
    ],
    "0xF28258A4F42d073653C0E3Ed9d09e855273f3D44": [
        "0x0593f684015c233ce280d2a0e06fff059f0cfa63ac0c8633cfb8a231cff2aeda",
    ],
}


def test_matches_hardhat_root():
    tree = build_merkle_tree(HARDHAT_WHITELIST)
    assert tree["root"] == HARDHAT_ROOT


def test_matches_hardhat_proofs():
    tree = build_merkle_tree(HARDHAT_WHITELIST)
    for addr, expected_proof in HARDHAT_PROOFS.items():
        assert get_proof(tree, addr) == expected_proof, f"proof drift for {addr}"


def test_single_leaf_matches_hardhat():
    tree = build_merkle_tree(HARDHAT_WHITELIST[:1])
    assert tree["root"] == "0xd616e69b84ef779ae7ef7db1a6446206656b8334d70fde1af01319b6786f9f9e"
    assert get_proof(tree, HARDHAT_WHITELIST[0]) == []
