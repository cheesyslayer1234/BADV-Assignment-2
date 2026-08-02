# CCN Day Carnival 2026 — Stall Management Smart Contract

A Solidity smart contract solution where students/staff apply to register a
carnival stall, the organiser approves or rejects each application, approved
stalls take public payments, stall owners can issue refunds, and withdrawals
are released only once the organiser processes the end of the carnival day
— plus a small web interface and two additional features: **Merkle-proof
eligibility verification** and a **CI/CD pipeline with a full unit test
suite**.

## Project structure

```
contracts/
  CarnivalStallManager.sol   # the smart contract
test/
  CarnivalStallManager.test.js  # 42-case Hardhat/Chai unit test suite
scripts/
  deploy.js                  # local/testnet deployment script
frontend/
  index.html                 # standalone web interface (ethers.js + MetaMask)
.github/workflows/ci.yml     # CI/CD pipeline: compile + test + coverage on every push,
                              # then auto-deploy to Sepolia on push to main
deployments/                  # deployment records written by scripts/deploy.js (gitignored)
CD-SETUP.md                  # one-time setup guide for the CD (Sepolia deploy) stage
Report.docx                  # design report (see assignment brief)
```

## Getting started

```bash
npm install
npx hardhat compile
npx hardhat test
```

To try it against a local blockchain:

```bash
npx hardhat node                       # terminal 1
npx hardhat run scripts/deploy.js --network localhost   # terminal 2
```

Copy the deployed address printed by the deploy script into
`CONTRACT_ADDRESS` near the top of `frontend/index.html`'s `<script>` block,
then open `frontend/index.html` in a browser with MetaMask connected to
`http://127.0.0.1:8545` (chain id `31337`).

## Core requirements implemented

1. **Stall registration (application)** — `registerStall(name, merkleProof)`.
   The caller must be eligible either via the organiser's
   `addAuthorisedRegistrant` whitelist, or by submitting a valid Merkle
   proof against the published `eligibleRegistrantsRoot` (see Additional
   Feature 1 below). Registering creates a `Pending` application, not an
   active stall: a whitelisted or eligible wallet can *apply*, but the
   organiser must separately call `approveStall`/`rejectStall` before it
   can accept payments. Both decisions are stamped with a `decidedAt`
   timestamp on top of the `appliedAt` timestamp recorded at submission,
   so every stall carries a full on-chain audit trail of who applied,
   when, and who approved/rejected it and when — enforced via the
   `onlyApprovedStall` modifier and custom errors `StallNotApproved` /
   `StallNotPending`.
2. **Public payments** — `payStall(stallId)`, a `payable` function any
   wallet can call from the web interface, but only once the stall has
   been organiser-approved.
3. **Stall-owner refunds** — `issueRefund(stallId, payer, amount)`, capped
   per-payer so an owner can never refund more than that specific customer
   paid.
4. **Post-carnival withdrawal** — `processCarnivalEnd()` (organiser-only,
   only after the carnival's end timestamp) followed by `withdrawFunds`
   (stall-owner-only, only once 24 hours have passed since processing).

## Additional features

1. **Merkle-proof eligibility verification** — directly answers the
   problem statement's call-out that *"there is also no mechanism in place
   to verify authentic registrations."* Instead of the organiser writing
   every eligible TP student/staff address to storage one-by-one, they
   publish a single `bytes32` Merkle root (`setEligibilityRoot`) computed
   off-chain from the full eligible list. Anyone in that list can register
   by submitting a Merkle proof; the contract recomputes the path with
   `MerkleProof.verify` (OpenZeppelin) and checks it resolves to the
   published root — without ever storing the full address list on-chain.
   This sits *alongside* the existing `authorisedRegistrants` whitelist as
   a second, cheaper eligibility path (`registerStall` accepts either).
   Leaves use the standard double-hash convention
   (`keccak256(keccak256(abi.encode(address)))`) to guard against
   second-preimage attacks on the tree. See `scripts/generate-merkle-root.js`
   for the off-chain tree-building/proof-generation tooling.
2. **CI/CD pipeline + unit test suite** — a Hardhat/Chai test suite
   covering every core requirement plus the Merkle-proof feature, backed by
   GitHub Actions (`.github/workflows/ci.yml`), which runs `hardhat compile`
   → `hardhat test` → `hardhat coverage` automatically on every push and
   pull request to `main`, so a broken build or a failing test is caught
   before it ever reaches a reviewer.

See `Report.docx` for full design documentation, including field/function
tables and error-handling discussion, following the assignment template.
