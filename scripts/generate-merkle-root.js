/**
 * scripts/generate-merkle-root.js
 *
 * OPTIONAL. The Organiser Desk (frontend/organiser.html) now does all of
 * this in the browser via frontend/js/merkle.js — add/remove addresses,
 * see the root update live, publish it on-chain, and copy the updated
 * list JSON, no Node or VS Code required. This script is kept around only
 * as a scriptable CLI alternative (e.g. for bulk-importing a huge list
 * from a spreadsheet export) and is no longer part of the normal workflow.
 *
 * Turns a plain list of eligible wallet addresses into:
 *   1. A single Merkle root — you can paste this straight into the
 *      contract via a block explorer, or just use the Organiser Desk.
 *   2. frontend/generated/eligible-registrants.json — the same public
 *      address list the Organiser Desk manages, so apply.html can look up
 *      whichever wallet is connected.
 *
 * You do NOT need to understand Merkle trees to use this. All you do is:
 *
 *   1. Copy eligible-registrants.example.json -> eligible-registrants.json
 *      and put your real list of eligible wallet addresses in it.
 *   2. Run:  npm run generate-merkle-root
 *   3. Copy the "Root to publish" value it prints and set it via
 *      `setEligibilityRoot` (e.g. from the Organiser Desk, or a block
 *      explorer's "write contract" tab).
 *   4. Commit + push frontend/generated/eligible-registrants.json (the
 *      script just wrote it) so it goes live on GitHub Pages.
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
const OUTPUT_FILE = path.join(OUTPUT_DIR, "eligible-registrants.json");

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

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      {
        "//": "Published, public list of eligible wallet addresses. Edited from the Organiser Desk (organiser.html) — no VS Code or npm script needed. apply.html fetches this file and computes its own Merkle proof client-side against whatever root the Organiser Desk most recently published on-chain.",
        updatedAt: new Date().toISOString(),
        addresses,
      },
      null,
      2
    )
  );

  console.log(`Read ${addresses.length} eligible address(es) from ${path.relative(ROOT_DIR, inputPath)}.\n`);
  console.log("Root to publish (via setEligibilityRoot, e.g. from the Organiser Desk or a block explorer):");
  console.log(`  ${root}\n`);
  console.log(`Address list written to: ${path.relative(ROOT_DIR, OUTPUT_FILE)}`);
  console.log("Commit and push that file so GitHub Pages serves it, then publish the root above.");
}

main();
