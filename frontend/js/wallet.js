/**
 * wallet.js
 *
 * Shared across index.html, manage.html and organiser.html:
 *   - contract config (address + ABI)
 *   - wallet connect/reconnect (via ethers.js + MetaMask)
 *   - toast notifications (replaces the old activity log)
 *   - hamburger drawer menu wiring
 *
 * Each page includes this file, then its own page script (stalls.js /
 * manage.js / organiser.js) which calls initWallet() and reacts to the
 * `wallet:ready` event once a signer + contract are available.
 *
 * CONTRACT_ADDRESS itself is NOT defined here anymore — it comes from
 * config.js, which must be loaded via <script src="config.js"></script>
 * BEFORE this file. config.js is auto-written by scripts/deploy.js on
 * every deploy, so the frontend always points at whatever you last
 * deployed without any manual editing.
 */

if (typeof CONTRACT_ADDRESS === "undefined") {
  throw new Error(
    "CONTRACT_ADDRESS is not defined — make sure config.js is included " +
      "with a <script> tag BEFORE wallet.js, and that you've deployed at " +
      "least once (npm run deploy:local or npm run deploy:sepolia)."
  );
}

const ABI = [
  "function organiser() view returns (address)",
  "function stallCount() view returns (uint256)",
  "function isAuthorisedRegistrant(address) view returns (bool)",
  "function isWithdrawalWindowOpen() view returns (bool)",
  "function eligibleRegistrantsRoot() view returns (bytes32)",
  "function isEligibleByProof(address account, bytes32[] merkleProof) view returns (bool)",
  "function setEligibilityRoot(bytes32 newRoot)",
  "function addAuthorisedRegistrant(address account)",
  "function removeAuthorisedRegistrant(address account)",
  "function registerStall(string name, bytes32[] merkleProof) returns (uint256)",
  "function approveStall(uint256 stallId)",
  "function rejectStall(uint256 stallId)",
  "function payStall(uint256 stallId) payable",
  "function issueRefund(uint256 stallId, address payable payer, uint256 amount)",
  "function processCarnivalEnd()",
  "function withdrawFunds(uint256 stallId)",
  "function getStall(uint256 stallId) view returns (address owner, string name, uint256 balance, bool withdrawn, uint256 totalPaid, uint8 status, uint256 appliedAt, uint256 decidedAt)",
  "event StallApplicationSubmitted(uint256 indexed stallId, address indexed applicant, string name, uint256 timestamp)",
  "event StallApproved(uint256 indexed stallId, address indexed organiser, uint256 timestamp)",
  "event StallRejected(uint256 indexed stallId, address indexed organiser, uint256 timestamp)",
  "event PaymentMade(uint256 indexed stallId, address indexed payer, uint256 amount)",
  "event EligibilityRootUpdated(bytes32 newRoot)"
];

let provider, signer, contract, userAddress;

/* ---------------- Cross-page connection flag ----------------
 * MetaMask's `eth_accounts` call is silent (no popup) and will happily
 * hand back an address on *every* page as long as this site is still
 * authorised in the wallet — that's what makes the auto reconnect work
 * as you move between index/manage/organiser/browse/apply.
 *
 * The problem: MetaMask has no real "disconnect" for that permission,
 * so without extra state, a page you land on next will just silently
 * reconnect again. We fix that with our own flag in localStorage that
 * every page checks before attempting the silent reconnect. Clicking
 * "Disconnect" clears it (and best-effort revokes the permission too);
 * clicking "Connect Wallet" sets it again. */
const WALLET_FLAG_KEY = 'ccn_wallet_connected';

/* ---------------- Toasts (replaces the activity log) ---------------- */

function ensureToastStack(){
  let stack = document.querySelector('.toast-stack');
  if(!stack){
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

function toast(msg, kind){
  const stack = ensureToastStack();
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  stack.appendChild(el);
  const life = kind === 'err' ? 6000 : 4200;
  setTimeout(()=>{
    el.classList.add('fade-out');
    setTimeout(()=> el.remove(), 260);
  }, life);
}
// kept as `log` too, so page scripts read naturally: log('...', 'ok'|'err')
const log = toast;

/* ---------------- Wallet connect / reconnect ---------------- */

function shortAddr(addr){ return addr.slice(0,6) + '…' + addr.slice(-4); }

function paintConnected(addr, net){
  const pill = document.getElementById('statusPill');
  const btn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  if(pill){
    pill.textContent = shortAddr(addr);
    pill.classList.add('is-connected');
  }
  if(btn){
    btn.textContent = 'Connected';
    btn.disabled = true;
    btn.style.display = 'none';
  }
  if(disconnectBtn){
    disconnectBtn.style.display = '';
  }
  const netEl = document.getElementById('networkName');
  if(netEl && net) netEl.textContent = net.name && net.name !== 'unknown' ? net.name : net.chainId.toString();
  const contractEl = document.getElementById('contractAddrShort');
  if(contractEl) contractEl.textContent = shortAddr(CONTRACT_ADDRESS);
}

function paintDisconnected(){
  const pill = document.getElementById('statusPill');
  const btn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  if(pill){
    pill.textContent = 'Wallet not connected';
    pill.classList.remove('is-connected');
  }
  if(btn){
    btn.textContent = 'Connect Wallet';
    btn.disabled = false;
    btn.style.display = '';
  }
  if(disconnectBtn){
    disconnectBtn.style.display = 'none';
  }
}

async function bindWallet(){
  signer = await provider.getSigner();
  userAddress = await signer.getAddress();
  contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
  const net = await provider.getNetwork();
  paintConnected(userAddress, net);
  document.dispatchEvent(new CustomEvent('wallet:ready', { detail: { userAddress, contract } }));
}

/** Called on every page load. Tries a *silent* reconnect (no popup) using
 *  eth_accounts — if this site was already authorised in MetaMask, the
 *  wallet reconnects automatically. Falls back to showing "Connect Wallet". */
function paintContractChrome(){
  const contractEl = document.getElementById('contractAddrShort');
  if(contractEl) contractEl.textContent = shortAddr(CONTRACT_ADDRESS);
  const drawerEl = document.getElementById('drawerContractAddr');
  if(drawerEl) drawerEl.textContent = shortAddr(CONTRACT_ADDRESS);
}

async function initWallet(){
  paintContractChrome();

  if(!window.ethereum){
    const pill = document.getElementById('statusPill');
    if(pill) pill.textContent = 'No wallet found';
    document.dispatchEvent(new CustomEvent('wallet:unavailable'));
    return;
  }

  // If the user explicitly disconnected on some other page, honour that
  // here too instead of silently reconnecting — this is what makes
  // "Disconnect" actually stick as you move between pages.
  if(localStorage.getItem(WALLET_FLAG_KEY) !== '1'){
    paintDisconnected();
    document.dispatchEvent(new CustomEvent('wallet:disconnected'));
    return;
  }

  provider = new ethers.BrowserProvider(window.ethereum);

  try{
    const accounts = await provider.send('eth_accounts', []); // silent, no popup
    if(accounts.length > 0){
      await bindWallet();
    }else{
      localStorage.removeItem(WALLET_FLAG_KEY);
      paintDisconnected();
      document.dispatchEvent(new CustomEvent('wallet:disconnected'));
    }
  }catch(err){
    localStorage.removeItem(WALLET_FLAG_KEY);
    paintDisconnected();
    document.dispatchEvent(new CustomEvent('wallet:disconnected'));
  }

  window.ethereum.on && window.ethereum.on('accountsChanged', ()=> window.location.reload());
  window.ethereum.on && window.ethereum.on('chainChanged', ()=> window.location.reload());
}

async function connectWallet(){
  if(!window.ethereum){
    toast('No injected wallet found. Install MetaMask to continue.', 'err');
    return;
  }
  try{
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []); // this one *does* prompt
    await bindWallet();
    localStorage.setItem(WALLET_FLAG_KEY, '1');
    toast('Wallet connected.', 'ok');
  }catch(err){
    toast('Connection failed: ' + (err.message || err), 'err');
  }
}

/** Disconnects the site's wallet state and stops the silent auto-reconnect
 *  on every other page. MetaMask itself doesn't expose a clean "disconnect"
 *  for eth_accounts permissions on all versions, so this does the best
 *  available thing: try the standard revoke call (recent MetaMask/EIP-2255
 *  wallets support it), then always clear our own local state regardless
 *  of whether that call succeeds. */
async function disconnectWallet(){
  try{
    if(window.ethereum && window.ethereum.request){
      await window.ethereum.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }]
      });
    }
  }catch(err){
    // Not all wallets support this yet — that's fine, we still clear
    // local state below so this site stops auto-reconnecting.
  }

  provider = undefined;
  signer = undefined;
  contract = undefined;
  userAddress = undefined;
  localStorage.removeItem(WALLET_FLAG_KEY);
  paintDisconnected();
  document.dispatchEvent(new CustomEvent('wallet:disconnected'));
  toast('Wallet disconnected.', 'ok');
}

document.addEventListener('DOMContentLoaded', ()=>{
  const btn = document.getElementById('connectBtn');
  if(btn) btn.addEventListener('click', connectWallet);
  const disconnectBtn = document.getElementById('disconnectBtn');
  if(disconnectBtn) disconnectBtn.addEventListener('click', disconnectWallet);
  initWallet();
  wireDrawer();
});

/* ---------------- Hamburger drawer menu ---------------- */

function wireDrawer(){
  const menuBtn = document.getElementById('menuBtn');
  const drawer = document.getElementById('drawer');
  const backdrop = document.getElementById('drawerBackdrop');
  const closeBtn = document.getElementById('drawerClose');
  if(!menuBtn || !drawer || !backdrop) return;

  function open(){
    drawer.classList.add('open');
    backdrop.classList.add('open');
    menuBtn.setAttribute('aria-expanded','true');
  }
  function close(){
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    menuBtn.setAttribute('aria-expanded','false');
  }
  menuBtn.addEventListener('click', ()=>{
    drawer.classList.contains('open') ? close() : open();
  });
  backdrop.addEventListener('click', close);
  if(closeBtn) closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') close(); });
}
