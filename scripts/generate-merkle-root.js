/**
 * scripts/generate-merkle-root.js
 *
 * Turns a plain list of eligible wallet addresses into:
 *   1. A single Merkle root — paste this into the Organiser Desk's
 *      "Publish eligibility root" box.
 *   2. frontend/generated/eligibility-proofs.json — a lookup table of
 *      one proof per address. apply.html fetches this file itself and
 *      auto-fills the right proof for whichever wallet is connected, so
 *      applicants never see or handle raw proof data.
 *
 * You do NOT need to understand Merkle trees to use this. All you do is:
 *
 *   1. Copy eligible-registrants.example.json -> eligible-registrants.json
 *      and put your real list of eligible wallet addresses in it.
 *   2. Run:  npm run generate-merkle-root
 *   3. Copy the "Root to publish" value it prints into the Organiser Desk
 *      and click "Publish eligibility root".
 *   4. Commit + push frontend/generated/eligibility-proofs.json (the
 *      script just wrote it) so it goes live on GitHub Pages.
 *
 * Re-run this any time the eligible list changes, then re-publish the
 * new root and re-push the new proofs file — old proofs stop working
 * automatically the moment a new root is published on-chain.
 *
 * Leaf convention matches the contract exactly:
 * keccak256(keccak256(abi.encode(address))) — see CarnivalStallManager.sol
 * and test/CarnivalStallManager.test.js for the same construction.
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

const ROOT_DIR = path.join(__dirname, "..");
const INPUT_CANDIDATES = [
  path.join(ROOT_DIR, "eligible-registrants.json"),
  path.join(ROOT_DIR, "eligible-registrants.example.json"),
];
const OUTPUT_DIR = path.join(ROOT_DIR, "frontend", "generated");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "eligibility-proofs.json");

function hashLeaf(address) {
  const innerHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address"], [address])
  );
  const outerHash = ethers.keccak256(innerHash);
  return Buffer.from(outerHash.slice(2), "hex");
}

function loadAddresses() {
  const inputPath = INPUT_CANDIDATES.find((p) => fs.existsSync(p));
  if (!inputPath) {
    console.error(
      "No eligible-registrants.json found.\n\n" +
        "Copy eligible-registrants.example.json to eligible-registrants.json " +
        "in the project root, fill in your real addresses, then re-run this script."
    );
    process.exit(1);
  }
  if (inputPath.endsWith(".example.json")) {
    console.warn(
      "WARNING: no eligible-registrants.json found — using the example file's " +
        "placeholder addresses. This is fine for a test run, but do NOT publish " +
        "the root it produces to a real carnival; copy the example file to " +
        "eligible-registrants.json with your real list first.\n"
    );
  }

  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const addresses = Array.isArray(raw) ? raw : raw.addresses;
  if (!Array.isArray(addresses) || addresses.length === 0) {
    console.error(`${inputPath} must contain a non-empty "addresses" array.`);
    process.exit(1);
  }

  const seen = new Set();
  const checksummed = [];
  for (const [i, addr] of addresses.entries()) {
    let normalised;
    try {
      normalised = ethers.getAddress(String(addr).trim());
    } catch (err) {
      console.error(`Entry ${i + 1} ("${addr}") is not a valid Ethereum address — fix it and re-run.`);
      process.exit(1);
    }
    if (seen.has(normalised)) continue; // silently de-duplicate
    seen.add(normalised);
    checksummed.push(normalised);
  }
  return { inputPath, addresses: checksummed };
}

function main() {
  const { inputPath, addresses } = loadAddresses();

  const leaves = addresses.map(hashLeaf);
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = tree.getHexRoot();

  const proofsByAddress = {};
  addresses.forEach((address, i) => {
    proofsByAddress[address] = tree.getHexProof(leaves[i]);
  });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      {
        root,
        generatedAt: new Date().toISOString(),
        sourceFile: path.relative(ROOT_DIR, inputPath),
        count: addresses.length,
        proofsByAddress,
      },
      null,
      2
    )
  );

  console.log(`Read ${addresses.length} eligible address(es) from ${path.relative(ROOT_DIR, inputPath)}.\n`);
  console.log("Root to publish (paste into Organiser Desk -> Eligible-registrants Merkle root):");
  console.log(`  ${root}\n`);
  console.log(`Proofs written to: ${path.relative(ROOT_DIR, OUTPUT_FILE)}`);
  console.log("Commit and push that file so GitHub Pages serves it, then publish the root above.");
}

main();
