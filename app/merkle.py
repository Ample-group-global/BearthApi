import logging

from eth_abi.packed import encode_packed
from eth_hash.auto import keccak

logger = logging.getLogger(__name__)


def encode_leaf(address: str) -> bytes:
    """keccak256(solidityPacked(["address"], [address.lower()]))"""
    logger.info("[encode_leaf] INPUT  → address      : %s", address)

    normalized = address.lower()
    logger.debug("[encode_leaf]          normalized   : %s", normalized)

    packed = encode_packed(["address"], [normalized])
    logger.debug("[encode_leaf]          abi-packed   : %s", packed.hex())

    leaf = keccak(packed)
    logger.info("[encode_leaf] OUTPUT → keccak256    : 0x%s", leaf.hex())
    return leaf


def _hash_pair(a: bytes, b: bytes) -> bytes:
    """Hash a pair of bytes with sortPairs behavior: sort before concatenating."""
    logger.info("[_hash_pair]  INPUT  → a            : 0x%s", a.hex())
    logger.info("[_hash_pair]           b            : 0x%s", b.hex())

    pair = sorted([a, b])
    logger.debug("[_hash_pair]           sorted[0]   : 0x%s", pair[0].hex())
    logger.debug("[_hash_pair]           sorted[1]   : 0x%s", pair[1].hex())

    result = keccak(pair[0] + pair[1])
    logger.info("[_hash_pair]  OUTPUT → parent hash  : 0x%s", result.hex())
    return result


def build_merkle_tree(addresses: list[str]) -> dict:
    """
    Returns {"layers": list[list[bytes]], "root": str}.
    Matches MerkleTree.js with sortPairs=true and natural odd-leaf promotion
    (duplicateOdd disabled). On odd-count layers the lone leaf is promoted to
    the next layer unchanged, producing OpenZeppelin-MerkleProof-compatible
    proofs for every leaf — including the lone one. Do NOT switch to
    duplicate-the-lone-leaf semantics: that produces unverifiable proofs for
    the duplicated leaf because the self-sibling is omitted from get_proof.
    """
    logger.info("=" * 72)
    logger.info("[build_merkle_tree] INPUT  → addresses (%d total):", len(addresses))
    for i, addr in enumerate(addresses):
        logger.info("                    [%d] %s", i, addr)

    if not addresses:
        logger.warning("[build_merkle_tree] OUTPUT → empty list — zero root returned")
        return {"layers": [], "root": "0x" + "0" * 64}

    # ── encode leaves ────────────────────────────────────────────────────────
    logger.info("-" * 72)
    logger.info("[build_merkle_tree] STEP: encode each address → leaf hash")
    leaves = [encode_leaf(a) for a in addresses]

    logger.info("-" * 72)
    logger.info("[build_merkle_tree] Layer 0 — leaves (%d):", len(leaves))
    for i, leaf in enumerate(leaves):
        logger.info("                    [%d] 0x%s", i, leaf.hex())

    layers = [leaves[:]]
    layer = leaves[:]
    level = 0

    # ── build layers ─────────────────────────────────────────────────────────
    while len(layer) > 1:
        level += 1
        logger.info("-" * 72)
        logger.info(
            "[build_merkle_tree] STEP: hash pairs → Layer %d  (input: %d node(s))",
            level, len(layer),
        )
        new_layer = []
        for i in range(0, len(layer) - 1, 2):
            logger.info(
                "[build_merkle_tree]   pair (%d,%d) INPUT  → left : 0x%s",
                i, i + 1, layer[i].hex(),
            )
            logger.info(
                "[build_merkle_tree]               INPUT  → right: 0x%s",
                layer[i + 1].hex(),
            )
            parent = _hash_pair(layer[i], layer[i + 1])
            logger.info(
                "[build_merkle_tree]   pair (%d,%d) OUTPUT → parent: 0x%s",
                i, i + 1, parent.hex(),
            )
            new_layer.append(parent)

        if len(layer) % 2 == 1:
            logger.info(
                "[build_merkle_tree]   ODD node — promote unchanged: 0x%s",
                layer[-1].hex(),
            )
            new_layer.append(layer[-1])

        layer = new_layer
        layers.append(layer[:])
        logger.info("[build_merkle_tree] Layer %d — output (%d node(s)):", level, len(layer))
        for i, node in enumerate(layer):
            logger.info("                    [%d] 0x%s", i, node.hex())

    root = "0x" + layers[-1][0].hex()
    logger.info("-" * 72)
    logger.info("[build_merkle_tree] OUTPUT → root: %s", root)
    logger.info("=" * 72)
    return {"layers": layers, "root": root}


def get_proof(tree: dict, address: str) -> list[str]:
    """
    Returns hex proof strings matching the inclusion proof for an address.
    Returns [] if address not in tree.
    """
    logger.info("=" * 72)
    logger.info("[get_proof] INPUT  → address: %s", address)

    layers = tree["layers"]
    if not layers:
        logger.warning("[get_proof] OUTPUT → tree empty — proof: []")
        return []

    logger.info("[get_proof] STEP: encode address → target leaf")
    target = encode_leaf(address)

    try:
        idx = layers[0].index(target)
    except ValueError:
        logger.warning("[get_proof] OUTPUT → address NOT in tree — proof: []")
        return []

    logger.info("[get_proof] STEP: found at leaf index %d — collecting siblings", idx)
    proof = []
    for level, layer in enumerate(layers[:-1]):
        sibling_idx = idx ^ 1
        logger.info(
            "[get_proof]   Layer %d  INPUT  → current idx: %d | sibling idx: %d",
            level, idx, sibling_idx,
        )
        if sibling_idx < len(layer):
            sibling = "0x" + layer[sibling_idx].hex()
            logger.info("[get_proof]   Layer %d  OUTPUT → sibling: %s", level, sibling)
            proof.append(sibling)
        else:
            logger.info("[get_proof]   Layer %d  OUTPUT → lone promoted node — no sibling, skip", level)
        idx = idx // 2

    logger.info("-" * 72)
    logger.info("[get_proof] OUTPUT → proof (%d element(s)):", len(proof))
    for i, p in enumerate(proof):
        logger.info("            [%d] %s", i, p)
    logger.info("=" * 72)
    return proof
