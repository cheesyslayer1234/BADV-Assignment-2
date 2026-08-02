# CCN Day Carnival 2026 — Stall Management Smart Contract

A Solidity smart contract solution where students/staff apply to register a
carnival stall, the organiser approves or rejects each application, approved
stalls take public payments, stall owners can issue refunds, and withdrawals
are released only once the organiser processes the end of the carnival day
— plus a small web interface and three additional features (organiser
approval workflow, on-chain ratings, and a CI-tested circuit breaker).

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
.github/workflows/ci.yml     # CI pipeline: compile + test + coverage on every push
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

1. **Stall registration (application)** — `registerStall(name)`, restricted
   to addresses the organiser has whitelisted as students/staff via
   `addAuthorisedRegistrant`. This creates a `Pending` application, not an
   active stall — see the approval workflow below.
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

1. **Organiser approval workflow** — a whitelisted wallet can *apply* for a
   stall (`registerStall`), but the application sits in `StallStatus.Pending`
   and cannot accept a single wei until the organiser calls `approveStall`.
   The organiser can instead `rejectStall` it, which permanently blocks
   payments. Both transitions are one-way and stamped with a `decidedAt`
   timestamp, on top of the `appliedAt` timestamp recorded at submission —
   so every stall carries a full, on-chain audit trail of who applied, when,
   and who approved/rejected it and when. This is on top of (and separate
   from) the whitelist check: being whitelisted lets you *apply*, it doesn't
   let you *skip review*. Enforced everywhere via the `onlyApprovedStall`
   modifier and custom errors `StallNotApproved` / `StallNotPending`.
2. **On-chain rating/review system** — genuine payers can rate a stall
   1–5 stars once each; the contract tracks a running average.
3. **Circuit breaker + CI/CD pipeline** — an organiser-controlled
   `pause`/`unpause` switch backed by a 42-test Hardhat suite. GitHub
   Actions (`.github/workflows/ci.yml`) runs `hardhat compile` → `hardhat
   test` → `hardhat coverage` automatically on every push and pull request
   to `main`, so a broken build or a failing test is caught before it ever
   reaches a reviewer.

See `Report.docx` for full design documentation, including field/function
tables and error-handling discussion, following the assignment template.
