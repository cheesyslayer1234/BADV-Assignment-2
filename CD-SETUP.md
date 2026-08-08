# Setting up Continuous Deployment (CD)

This guide walks through the steps needed to make the `deploy-testnet` job in
`.github/workflows/ci.yml` actually run. It's separate from the main README
because it's a one-time setup checklist you (or a teammate) follow once,
rather than day-to-day usage instructions.

Do this a few days before the deadline, not the night before — testnet
faucets can be slow or rate-limited.

## What this CD stage does

On every push to `main`, once `build-and-test` passes, `deploy-testnet`:
1. Compiles the contract again (clean environment).
2. Deploys `CarnivalStallManager` to the **Sepolia** test network using
   `scripts/deploy.js`.
3. Writes the deployed address + timestamp to `deployments/sepolia.json`.
4. Uploads that file as a workflow artifact and prints it in the run summary.

No real money is involved anywhere in this process.

## Step 1 — Get a free Sepolia RPC URL (~10 min)

1. Sign up at [Alchemy](https://www.alchemy.com/) or [Infura](https://www.infura.io/) (either is fine, both have generous free tiers).
2. Create a new app and select the **Sepolia** network.
3. Copy the HTTPS RPC URL, e.g. `https://eth-sepolia.g.alchemy.com/v2/<your-key>`.

## Step 2 — Create a dedicated deployer wallet (~5 min)

**Do not use your personal wallet.** Create a brand-new one that will only
ever hold worthless testnet ETH.

1. Open MetaMask → Add account → new account (or a fresh install).
2. Copy its address (for the faucet in Step 3).
3. Export its private key: Account details → Show private key.
   - Treat this like a password. Never paste it into code, commit it, or
     share it — it goes into GitHub Secrets only (Step 5).

## Step 3 — Fund it with free Sepolia ETH (~5–15 min)

Use a faucet, e.g.:
- [Alchemy Sepolia Faucet](https://sepoliafaucet.com/)
- [Google Cloud Web3 Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)

Paste the deployer address from Step 2 and request funds. This can take a
few minutes, and some faucets require you to sign in or hold a small amount
of mainnet ETH elsewhere — if one is slow/blocked, try another.

## Step 4 — Confirm the local config expects these values

Already done in this repo — `hardhat.config.js` reads:

```js
require("dotenv").config();

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

networks: {
  hardhat: {},
  sepolia: {
    url: SEPOLIA_RPC_URL,
    accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
  },
},
```

If you want to test a deploy from your own machine before relying on CI,
create a local `.env` (already gitignored, never commit it):

```
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your-key
PRIVATE_KEY=your-deployer-private-key
```

Then run:

```bash
npm install
npm run deploy:sepolia
```

You should see `CarnivalStallManager deployed to: 0x...` and a new file at
`deployments/sepolia.json`.

## Step 5 — Add the secrets to GitHub (~10 min)

The GitHub Actions job never sees your `.env` file — it needs its own copy
of these values, stored as encrypted repo secrets:

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret** and add:
   - Name: `SEPOLIA_RPC_URL` → Value: the RPC URL from Step 1.
   - Name: `PRIVATE_KEY` → Value: the deployer private key from Step 2.
3. Save both.

These are only ever injected into the workflow as environment variables
(`${{ secrets.SEPOLIA_RPC_URL }}`, `${{ secrets.PRIVATE_KEY }}`) — they're
never printed in logs or visible to pull requests from forks.

## Step 6 — Push to main and watch it run

```bash
git add .
git commit -m "Add CD: deploy to Sepolia on push to main"
git push origin main
```

Go to the **Actions** tab on GitHub. You should see:
- `build-and-test` run first.
- `deploy-testnet` run after it succeeds (only on `push` to `main`, not on
  pull requests — see the `if:` condition in `ci.yml`).
- A run summary showing the deployed contract address.
- A downloadable `sepolia-deployment` artifact containing `sepolia.json`.
- A follow-up commit from `github-actions[bot]` syncing `frontend/js/config.js`
  to the address it just deployed (message ends in `[skip ci]`, so it
  won't re-trigger the workflow).
- `deploy-pages` run last, publishing `frontend/` (with that just-synced
  config) to GitHub Pages.

## Step 7 — One-time GitHub Pages setup (~2 min)

`deploy-pages` in `ci.yml` publishes the `frontend/` folder automatically
on every push to `main`, but Pages needs to be told to accept deployments
from Actions before that job can succeed:

1. Go to your GitHub repo → **Settings** → **Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**
   (not "Deploy from a branch").
3. That's it — no branch or folder to pick manually; the workflow handles
   it. After the next push to `main`, your site will be live at
   `https://<your-username>.github.io/<your-repo>/`.

Because `deploy-testnet` commits the freshly deployed address back to
`frontend/js/config.js` *before* `deploy-pages` runs (see Step 6), the
published site always points at whichever contract was deployed by that
same run — never a stale address.

## Things to double check

- **Never commit a private key.** `.env` and `deployments/` are already in
  `.gitignore`. If a real key is ever accidentally committed, treat that
  wallet as compromised — rotate it, even though it's testnet-only.
- **Every push to `main` redeploys** the contract, producing a *new*
  address each time (the constructor sets a fresh end time), and Pages
  republishes to match. If your report or demo needs to reference one
  fixed address, either:
  - deploy once manually and stop pushing to `main` after that, or
  - change the trigger to something less frequent, e.g. only on a git tag:
    ```yaml
    if: github.ref_type == 'tag'
    ```
- **The bot's `[skip ci]` config-sync commit is expected**, not a bug —
  without it `frontend/js/config.js` would silently go stale after every
  CI redeploy. If you ever see the workflow apparently "run twice" per
  push, check it's actually this sync commit (which is skipped) and not a
  real second trigger.
- **Faucets near the deadline can be flaky.** Get testnet ETH early.

## Cost summary

| Item | Cost |
|---|---|
| Sepolia testnet ETH | Free (faucet) |
| Alchemy/Infura RPC | Free tier (way more than a student project needs) |
| GitHub Actions minutes | Free for public repos; free tier covers this easily for private repos |

**Total: $0.**
