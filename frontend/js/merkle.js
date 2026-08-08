/**
 * merkle.js
 *
 * Everything needed to turn a plain list of wallet addresses into the same
 * Merkle root / proofs the contract expects — entirely in the browser, so
 * nobody needs Node, VS Code, or `npm run generate-merkle-root` anymore.
 *
 * Leaf + tree convention matches contracts/CarnivalStallManager.sol and
 * scripts/generate-merkle-root.js exactly:
 *   - leaf = keccak256(keccak256(abi.encode(address)))
 *   - parent = keccak256(sortedConcat(left, right))
 *   - an odd node at any level carries straight up to the next level
 *     unchanged (no self-duplication) — same as merkletreejs's
 *     `{ sortPairs: true }` mode, which the contract's proof verification
 *     (OpenZeppelin MerkleProof.verify) assumes.
 *
 * Requires ethers (loaded via CDN in each page) to already be on `window`.
 */

const Merkle = (() => {
  function normaliseAddresses(addresses) {
    const seen = new Set();
    const out = [];
    for (const raw of addresses) {
      const trimmed = String(raw).trim();
      if (!trimmed) continue;
      const checksummed = ethers.getAddress(trimmed); // throws if invalid
      if (seen.has(checksummed)) continue;
      seen.add(checksummed);
      out.push(checksummed);
    }
    return out;
  }

  function hashLeaf(address) {
    const checksummed = ethers.getAddress(address);
    const inner = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["address"], [checksummed])
    );
    return ethers.keccak256(inner);
  }

  function combine(a, b) {
    const [lo, hi] = BigInt(a) <= BigInt(b) ? [a, b] : [b, a];
    return ethers.keccak256(ethers.concat([lo, hi]));
  }

  function buildLayers(leaves) {
    const layers = [leaves];
    let current = leaves;
    while (current.length > 1) {
      const next = [];
      for (let i = 0; i < current.length; i += 2) {
        if (i + 1 < current.length) {
          next.push(combine(current[i], current[i + 1]));
        } else {
          next.push(current[i]); // odd one out, carried up unchanged
        }
      }
      layers.push(next);
      current = next;
    }
    return layers;
  }

  /** Build a tree from a raw address list (deduplicated + checksummed first). */
  function buildTree(rawAddresses) {
    const addresses = normaliseAddresses(rawAddresses);
    const leaves = addresses.map(hashLeaf);
    const layers = buildLayers(leaves.length ? leaves : [ethers.ZeroHash]);
    return { addresses, leaves, layers };
  }

  function getRoot(tree) {
    if (tree.addresses.length === 0) return ethers.ZeroHash;
    const top = tree.layers[tree.layers.length - 1];
    return top[0];
  }

  function getProof(tree, address) {
    const target = hashLeaf(address);
    let index = tree.leaves.indexOf(target);
    if (index === -1) return null;
    const proof = [];
    for (let li = 0; li < tree.layers.length - 1; li++) {
      const layer = tree.layers[li];
      const isRight = index % 2 === 1;
      const pairIndex = isRight ? index - 1 : index + 1;
      if (pairIndex < layer.length) proof.push(layer[pairIndex]);
      index = Math.floor(index / 2);
    }
    return proof;
  }

  return { normaliseAddresses, hashLeaf, buildTree, getRoot, getProof };
})();
