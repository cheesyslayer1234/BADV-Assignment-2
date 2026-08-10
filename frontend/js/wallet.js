
if (typeof CONTRACT_ADDRESS === "undefined") {
  throw new Error(
    "CONTRACT_ADDRESS is not defined - make sure config.js is included " +
      "with a <script> tag BEFORE wallet.js, and that you've deployed at " +
      "least once (npm run deploy:local or npm run deploy:sepolia)."
  );
}

const ABI = [
  "function organiser() view returns (address)",
  "function carnivalEndTime() view returns (uint256)",
  "function carnivalProcessed() view returns (bool)",
  "function carnivalProcessedAt() view returns (uint256)",
  "function stallCount() view returns (uint256)",
  "function isWithdrawalWindowOpen() view returns (bool)",
  "function contractBalance() view returns (uint256)",
  "function registerStall(string name) returns (uint256)",
  "function approveStall(uint256 stallId)",
  "function rejectStall(uint256 stallId, string reason)",
  "function resubmitStall(uint256 stallId, string newName)",
  "function payStall(uint256 stallId) payable",
  "function issueRefund(uint256 stallId, address payer, uint256 amount)",
  "function processCarnivalEnd()",
  "function withdrawFunds(uint256 stallId)",
  "function getStall(uint256 stallId) view returns (address owner, string name, uint256 balance, bool withdrawn, uint256 totalPaid, uint8 status, uint256 appliedAt, uint256 decidedAt, string rejectionReason)",
  "function getPayerCredit(uint256 stallId, address payer) view returns (uint256)",
  "function getPendingApplication(address applicant) view returns (bool hasPending, uint256 stallId)",
  "function hasPendingApplication(address) view returns (bool)",
  "function pendingStallIdOf(address) view returns (uint256)",
  "event StallApplicationSubmitted(uint256 indexed stallId, address indexed applicant, string name, uint256 timestamp)",
  "event StallApproved(uint256 indexed stallId, address indexed organiser, uint256 timestamp)",
  "event StallRejected(uint256 indexed stallId, address indexed organiser, string reason, uint256 timestamp)",
  "event StallResubmitted(uint256 indexed stallId, address indexed owner, uint256 timestamp)",
  "event PaymentMade(uint256 indexed stallId, address indexed payer, uint256 amount)",
  "event RefundIssued(uint256 indexed stallId, address indexed payer, uint256 amount)",
  "event CarnivalProcessed(uint256 timestamp)",
  "event FundsWithdrawn(uint256 indexed stallId, address indexed owner, uint256 amount)",
  
  
  
  
  "error NotOrganiser()",
  "error NotStallOwner(uint256 stallId)",
  "error StallDoesNotExist(uint256 stallId)",
  "error ReentrancyDetected()",
  "error CarnivalNotYetProcessed()",
  "error NothingToWithdraw()",
  "error InsufficientStallBalance(uint256 available, uint256 requested)",
  "error InsufficientPayerCredit(uint256 available, uint256 requested)",
  "error ZeroAmount()",
  "error EmptyStallName()",
  "error AlreadyProcessed()",
  "error TooEarlyToProcess()",
  "error TransferFailed()",
  "error StallNotPending(uint256 stallId)",
  "error StallNotApproved(uint256 stallId)",
  "error StallNotRejected(uint256 stallId)",
  "error EmptyRejectionReason()",
  "error ApplicantHasPendingApplication(address applicant, uint256 pendingStallId)"
];

let provider, signer, contract, userAddress;
let isWrongNetwork = false; 

const CHAIN_IDS_BY_NETWORK = {
  localhost: 31337n,
  hardhat: 31337n,
  sepolia: 11155111n,
};
const EXPECTED_CHAIN_ID = CHAIN_IDS_BY_NETWORK[CONTRACT_NETWORK];

const WALLET_FLAG_KEY = 'ccn_wallet_connected';

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

  const iconName = kind === 'ok' ? 'circle-check' : kind === 'err' ? 'circle-x' : 'loader-circle';
  const icon = document.createElement('i');
  icon.className = 'toast-icon';
  icon.setAttribute('data-lucide', iconName);

  const text = document.createElement('span');
  text.textContent = msg;

  el.appendChild(icon);
  el.appendChild(text);
  stack.appendChild(el);
  if(window.lucide) lucide.createIcons();

  const life = kind === 'err' ? 6000 : 4200;
  setTimeout(()=>{
    el.classList.add('fade-out');
    setTimeout(()=> el.remove(), 260);
  }, life);
}

const log = toast;

const MESSAGES = {
  checkingWallet: 'Checking wallet…',
  connectToLoadStalls: 'Connect your wallet to load stalls.',
  connectToSeeApplications: 'Connect your wallet to see your applications.',
  loadingStalls: 'Loading stalls…',
  loadingApplications: 'Loading applications…',
  loadingYourApplications: 'Loading…',
  noStalls: 'No stalls available yet.',
  noApplicationsYet: "You haven't applied for a stall yet.",
  noPendingApplications: 'No pending applications right now.',
  noDecidedStalls: 'No decided stalls yet.',
  couldNotLoadStalls: 'Could not load stalls.',
  couldNotLoadApplications: 'Could not load applications.',
  couldNotLoadYourApplications: 'Could not load your applications.',
  alreadyHasPendingApplication: "You already have an application awaiting a decision - you can't submit another until it's approved or rejected.",
};

function emptyState(message, { spinner = false } = {}){
  return `<p class="empty-state">${spinner ? '<span class="spinner"></span>&nbsp; ' : ''}${message}</p>`;
}

const CUSTOM_ERROR_MESSAGES = {
  ApplicantHasPendingApplication: (args) =>
    `You already have an application pending (Stall #${args?.[1] ?? args?.pendingStallId ?? '?'}) - ` +
    `wait for the organiser to approve or reject it before submitting another.`,
  EmptyStallName: () => 'Enter a stall name first.',
  EmptyRejectionReason: () => 'Enter a reason before rejecting.',
  StallNotPending: () => 'This application has already been decided - it can\'t be actioned again.',
  StallNotApproved: () => 'This stall isn\'t approved yet, so it can\'t accept payments.',
  StallNotRejected: () => 'Only a rejected application can be resubmitted.',
  StallDoesNotExist: () => 'That stall doesn\'t exist.',
  NotStallOwner: () => 'Only the stall owner can do that.',
  NotOrganiser: () => 'Only the organiser can do that.',
  ZeroAmount: () => 'Enter an amount greater than zero.',
  NothingToWithdraw: () => 'There are no funds left to withdraw for this stall.',
  CarnivalNotYetProcessed: () => 'Withdrawals open once the organiser has processed the carnival.',
  TooEarlyToProcess: () => 'The carnival hasn\'t ended yet - check back after it wraps up.',
  AlreadyProcessed: () => 'The carnival has already been marked as processed.',
  InsufficientPayerCredit: (args) =>
    `That refund is more than this payer contributed (they have ${args?.[0] ?? '?'} wei of credit left).`,
  InsufficientStallBalance: (args) =>
    `The stall doesn't have enough balance left to cover that refund (${args?.[0] ?? '?'} wei available).`,
};

function friendlyError(err){
  console.error(err);

  
  if(err && (err.code === 'ACTION_REJECTED' || err.code === 4001)){
    return 'Transaction cancelled.';
  }

  
  
  
  
  const decoded = err && (err.revert || err.info?.error?.data ? err.revert : undefined);
  if(decoded && decoded.name && CUSTOM_ERROR_MESSAGES[decoded.name]){
    try{ return CUSTOM_ERROR_MESSAGES[decoded.name](decoded.args); }
    catch(_e){  }
  }

  
  
  let reason =
    err && (err.reason || err.shortMessage || err.info?.error?.message || err.data?.message);
  if(reason){
    reason = String(reason).replace(/^execution reverted:\s*/i, '').trim();
    // The reason string is sometimes just the bare custom error name (no
    // args) e.g. "ApplicantHasPendingApplication" - reuse the friendly
    // map for those too, falling back to the raw name only if unmapped.
    const bareName = reason.match(/^([A-Za-z0-9_]+)(\(.*\))?$/);
    if(bareName && CUSTOM_ERROR_MESSAGES[bareName[1]]){
      try{ return CUSTOM_ERROR_MESSAGES[bareName[1]](); }catch(_e){ /* ignore */ }
    }
    // Guard against ethers still handing back something huge/JSON-ish.
    if(reason && reason.length <= 160 && !/^\{|^\[/.test(reason)) return reason;
  }

  return 'Something went wrong - please try again.';
}

/* ---------------- Wallet connect / reconnect ---------------- */

function shortAddr(addr){ return addr.slice(0,8) + '••••••' + addr.slice(-6); }

function paintConnected(addr, net){
  const pill = document.getElementById('statusPill');
  const btn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  isWrongNetwork = false;
  if(pill){
    pill.textContent = shortAddr(addr);
    pill.classList.remove('is-error');
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
  const contractEl = document.getElementById('drawerContractAddr');
  if(contractEl) contractEl.textContent = shortAddr(CONTRACT_ADDRESS);
}

function paintDisconnected(){
  const pill = document.getElementById('statusPill');
  const btn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  isWrongNetwork = false;
  if(pill){
    pill.textContent = 'Wallet not connected';
    pill.classList.remove('is-connected', 'is-error');
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

function paintWrongNetwork(net){
  const pill = document.getElementById('statusPill');
  const netEl = document.getElementById('networkName');
  const btn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  if(pill){
    pill.textContent = 'Wrong network';
    pill.classList.remove('is-connected');
    pill.classList.add('is-error');
  }
  if(netEl){
    netEl.textContent = (net.name && net.name !== 'unknown' ? net.name : net.chainId.toString()) +
      ` (expected ${CONTRACT_NETWORK})`;
  }
  
  if(btn){
    btn.textContent = `Switch to ${CONTRACT_NETWORK}`;
    btn.disabled = false;
    btn.style.display = '';
  }
  isWrongNetwork = true;
  if(disconnectBtn){
    disconnectBtn.style.display = '';
  }
}

/** Asks MetaMask to switch to the network CONTRACT_ADDRESS was deployed on.
 *  Only wired up for chains MetaMask already knows about (sepolia is a
 *  well-known chain id it can switch to directly; a local hardhat node
 *  isn't something we can safely auto-add since its RPC URL varies). */
async function switchToExpectedNetwork(){
  if(!window.ethereum || !EXPECTED_CHAIN_ID) return;
  try{
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x' + EXPECTED_CHAIN_ID.toString(16) }]
    });
    
  }catch(err){
    console.error(err);
    toast(
      `Couldn't switch automatically - please switch MetaMask to ${CONTRACT_NETWORK} manually.`,
      'err'
    );
  }
}

async function bindWallet(){
  signer = await provider.getSigner();
  userAddress = await signer.getAddress();
  const net = await provider.getNetwork();

  if(EXPECTED_CHAIN_ID && net.chainId !== EXPECTED_CHAIN_ID){
    
    
    
    
    
    
    contract = undefined;
    paintWrongNetwork(net);
    toast(
      `Wrong network: wallet is on ${net.name && net.name !== 'unknown' ? net.name : 'chain ' + net.chainId} ` +
      `but this contract lives on ${CONTRACT_NETWORK}. Switch MetaMask and try again.`,
      'err'
    );
    document.dispatchEvent(new CustomEvent('wallet:wrong-network', { detail: { net, expected: CONTRACT_NETWORK } }));
    return;
  }

  contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
  paintConnected(userAddress, net);
  document.dispatchEvent(new CustomEvent('wallet:ready', { detail: { userAddress, contract } }));
}

function paintContractChrome(){
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

  
  
  
  if(localStorage.getItem(WALLET_FLAG_KEY) !== '1'){
    paintDisconnected();
    document.dispatchEvent(new CustomEvent('wallet:disconnected'));
    return;
  }

  provider = new ethers.BrowserProvider(window.ethereum);

  try{
    const accounts = await provider.send('eth_accounts', []); 
    if(accounts.length > 0){
      await bindWallet();
    }else{
      localStorage.removeItem(WALLET_FLAG_KEY);
      paintDisconnected();
      document.dispatchEvent(new CustomEvent('wallet:disconnected'));
    }
  }catch(err){
    console.error(err);
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
    await provider.send('eth_requestAccounts', []); 
    await bindWallet();
    localStorage.setItem(WALLET_FLAG_KEY, '1');
    toast('Wallet connected.', 'ok');
  }catch(err){
    toast('Connection failed: ' + friendlyError(err), 'err');
  }
}

async function disconnectWallet(){
  try{
    if(window.ethereum && window.ethereum.request){
      await window.ethereum.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }]
      });
    }
  }catch(err){
    
    
    console.error(err);
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
  if(btn) btn.addEventListener('click', ()=> isWrongNetwork ? switchToExpectedNetwork() : connectWallet());
  const disconnectBtn = document.getElementById('disconnectBtn');
  if(disconnectBtn) disconnectBtn.addEventListener('click', disconnectWallet);
  initWallet();
  wireDrawer();
  if(window.lucide) lucide.createIcons();
});

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
