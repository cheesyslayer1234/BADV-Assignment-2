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
  generate-merkle-root.js    # optional CLI alternative to the in-browser tool;
                              # not needed for day-to-day use anymore
frontend/
  index.html, apply.html,
  browse.html, manage.html,
  organiser.html             # standalone web interface (ethers.js + MetaMask)
  css/styles.css             # shared styling
  js/config.js               # deployed contract address (auto-written by scripts/deploy.js)
  js/wallet.js               # shared wallet connect + contract config
  js/merkle.js                # client-side Merkle tree (build root, compute proofs — no Node needed)
  js/apply.js, browse.js,
  js/manage.js, organiser.js # page-specific logic
  generated/eligible-registrants.json  # public list of eligible wallets, edited from
                              # the Organiser Desk; committed (not gitignored)
.github/workflows/ci.yml     # CI/CD pipeline: compile + test + coverage on every push,
                              # then auto-deploy to Sepolia and publish frontend/ to
                              # GitHub Pages on push to main (see CD-SETUP.md)
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

The deploy script automatically writes the deployed address into
`frontend/js/config.js` — no manual editing needed. Just open
`frontend/index.html` in a browser with MetaMask connected to
`http://127.0.0.1:8545` (chain id `31337`).

## Core requirements implemented

1. **Stall registration (application)** — `registerStall(name, merkleProof)`.
   The caller must submit a valid Merkle proof against the published
   `eligibleRegistrantsRoot` (see Additional Feature 1 below). Registering
   creates a `Pending` application, not an active stall: an eligible wallet
   can *apply*, but the
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
   This is the *only* eligibility path — there's no separate on-chain
   whitelist to keep in sync with it. Leaves use the standard double-hash
   convention (`keccak256(keccak256(abi.encode(address)))`) to guard
   against second-preimage attacks on the tree.

   **Organiser workflow** (no crypto background, no Node, no VS Code
   needed): everything happens on the Organiser Desk (`organiser.html`)
   in the browser, via `frontend/js/merkle.js`.
   1. Add or remove wallet addresses in the "Eligible registrants" panel.
      The page builds the Merkle tree and root for you live, as you type.
   2. Click "Publish root to blockchain" — one MetaMask transaction, done.
   3. Click "Copy updated list JSON" and paste it over the contents of
      `frontend/generated/eligible-registrants.json` using GitHub's own
      web file editor (no git needed, works from a phone). This step only
      matters for people who were just added or removed — everyone
      already on the list is unaffected — and it's what lets applicants'
      browsers work out their own proof (see below).

   From there it's invisible to applicants: `apply.html` fetches that
   published list itself and computes the right proof for whichever
   wallet is connected, using the same `merkle.js` helper, so nobody ever
   sees or pastes raw proof data. `scripts/generate-merkle-root.js` still
   exists as an optional Node CLI alternative (e.g. for scripting bulk
   imports), but it's no longer part of the day-to-day workflow.
2. **CI/CD pipeline + unit test suite** — a Hardhat/Chai test suite
   covering every core requirement plus the Merkle-proof feature, backed by
   GitHub Actions (`.github/workflows/ci.yml`), which runs `hardhat compile`
   → `hardhat test` → `hardhat coverage` automatically on every push and
   pull request to `main`, so a broken build or a failing test is caught
   before it ever reaches a reviewer.

See `Report.docx` for full design documentation, including field/function
tables and error-handling discussion, following the assignment template.
