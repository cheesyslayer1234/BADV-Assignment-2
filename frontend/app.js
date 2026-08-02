/**
 * app.js
 *
 * Frontend logic for the CCN Day Carnival 2026 Stall Exchange UI.
 * Talks to the deployed CarnivalStallManager contract via ethers.js
 * and MetaMask. Loaded by frontend/index.html.
 *
 * Before deploying/demoing:
 *   1. Deploy the contract (see scripts/deploy.js).
 *   2. Paste the deployed address into CONTRACT_ADDRESS below.
 */

const CONTRACT_ADDRESS = "0x9D7f74d0C41E726EC95884E0e97Fa6129e3b5E99";

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

const logBox = document.getElementById('logBox');
function log(msg, kind){
  const line = document.createElement('div');
  line.className = kind || '';
  line.textContent = `› ${msg}`;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

document.getElementById('contractAddrShort').textContent =
  CONTRACT_ADDRESS.slice(0,6) + '…' + CONTRACT_ADDRESS.slice(-4);

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    ['stalls','manage','admin'].forEach(t=>{
      document.getElementById('tab-'+t).style.display = (t===btn.dataset.tab) ? 'block' : 'none';
    });
  });
});

async function connectWallet(){
  if(!window.ethereum){
    log('No injected wallet found. Install MetaMask to continue.', 'err');
    return;
  }
  try{
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

    const net = await provider.getNetwork();
    document.getElementById('networkName').textContent = net.name || net.chainId.toString();
    document.getElementById('statusPill').textContent =
      `Connected: ${userAddress.slice(0,6)}…${userAddress.slice(-4)}`;
    log('Wallet connected.', 'ok');
    loadStalls();
    tryAutoFillProof();
  }catch(err){
    log('Connection failed: ' + (err.message || err), 'err');
  }
}
document.getElementById('connectBtn').addEventListener('click', connectWallet);

async function tryAutoFillProof(){
  // Optional convenience: if this page is served alongside
  // generated/eligibility-proofs.json (produced by
  // scripts/generate-merkle-root.js), auto-fill the connected wallet's
  // proof so they don't have to paste it manually. Silently does nothing
  // if the file isn't reachable (e.g. opening index.html directly via
  // file://, or no eligibility root has been generated yet).
  try{
    const res = await fetch('../generated/eligibility-proofs.json');
    if(!res.ok) return;
    const data = await res.json();
    const proof = data.proofsByAddress && data.proofsByAddress[ethers.getAddress(userAddress)];
    if(proof){
      document.getElementById('proofInput').value = JSON.stringify(proof);
      log('Eligibility proof auto-filled for this wallet.', 'ok');
    }
  }catch(err){
    // no proofs file reachable — fine, whitelist path still works
  }
}

async function loadStalls(){
  if(!contract) return;
  const grid = document.getElementById('stallGrid');
  grid.innerHTML = '';
  try{
    const count = await contract.stallCount();
    for(let i=0; i<Number(count); i++){
      const s = await contract.getStall(i);

      const statusNames = ['None', 'Pending', 'Approved', 'Rejected'];
      const statusClasses = ['', 'status-pending', 'status-approved', 'status-rejected'];
      const status = Number(s.status);
      const isApproved = status === 2;

      const card = document.createElement('div');
      card.className = 'stall-card';
      card.innerHTML = `
        <div class="id-tag">STALL #${i}</div>
        <span class="status-badge ${statusClasses[status]}">${statusNames[status]}</span>
        <h3>${s.name}</h3>
        <div class="owner">${s.owner}</div>
        <div class="meta"><span>Balance</span><b>${ethers.formatEther(s.balance)} ETH</b></div>
        ${isApproved ? `
        <div class="field-row" style="margin-bottom:8px;">
          <div class="field"><label>Amount (ETH)</label><input class="pay-amount" placeholder="0.05" /></div>
        </div>
        <div class="actions">
          <button class="primary pay-btn">Pay stall</button>
        </div>` : `<p class="hint">${status===1 ? 'Awaiting organiser approval — payments are disabled until then.' : 'This application was rejected and cannot accept payments.'}</p>`}
        `;

      if(isApproved){
        card.querySelector('.pay-btn').addEventListener('click', async ()=>{
          const amt = card.querySelector('.pay-amount').value || '0';
          try{
            const tx = await contract.payStall(i, { value: ethers.parseEther(amt) });
            log(`Paying stall #${i}: ${amt} ETH — tx ${tx.hash.slice(0,10)}…`);
            await tx.wait();
            log(`Payment confirmed for stall #${i}.`, 'ok');
            loadStalls();
          }catch(err){ log('Payment failed: ' + (err.reason || err.message || err), 'err'); }
        });
      }

      grid.appendChild(card);
    }
    if(Number(count)===0){
      grid.innerHTML = '<p class="hint">No stalls registered yet.</p>';
    }
  }catch(err){
    log('Could not load stalls: ' + (err.reason || err.message || err), 'err');
  }
}
document.getElementById('refreshBtn').addEventListener('click', loadStalls);

document.getElementById('registerBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('stallNameInput').value.trim();
  if(!name){ log('Enter a stall name first.', 'err'); return; }
  let proof = [];
  const proofRaw = document.getElementById('proofInput').value.trim();
  if(proofRaw){
    try{
      proof = JSON.parse(proofRaw);
      if(!Array.isArray(proof)) throw new Error('not an array');
    }catch(err){
      log('Eligibility proof must be a JSON array of bytes32 hex strings.', 'err');
      return;
    }
  }
  try{
    const tx = await contract.registerStall(name, proof);
    log(`Registering "${name}" — tx ${tx.hash.slice(0,10)}…`);
    await tx.wait();
    log('Stall registered.', 'ok');
    document.getElementById('stallNameInput').value = '';
    document.getElementById('proofInput').value = '';
    loadStalls();
  }catch(err){ log('Registration failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('refundBtn').addEventListener('click', async ()=>{
  const stallId = document.getElementById('refundStallId').value;
  const payer = document.getElementById('refundPayer').value.trim();
  const amount = document.getElementById('refundAmount').value;
  try{
    const tx = await contract.issueRefund(stallId, payer, ethers.parseEther(amount));
    log(`Refunding ${amount} ETH to ${payer.slice(0,8)}… — tx ${tx.hash.slice(0,10)}…`);
    await tx.wait();
    log('Refund sent.', 'ok');
    loadStalls();
  }catch(err){ log('Refund failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('withdrawBtn').addEventListener('click', async ()=>{
  const stallId = document.getElementById('withdrawStallId').value;
  try{
    const tx = await contract.withdrawFunds(stallId);
    log(`Withdrawing funds for stall #${stallId} — tx ${tx.hash.slice(0,10)}…`);
    await tx.wait();
    log('Withdrawal complete.', 'ok');
    loadStalls();
  }catch(err){ log('Withdrawal failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('addWhitelistBtn').addEventListener('click', async ()=>{
  const addr = document.getElementById('whitelistAddr').value.trim();
  try{
    const tx = await contract.addAuthorisedRegistrant(addr);
    log(`Authorising ${addr.slice(0,8)}… — tx ${tx.hash.slice(0,10)}…`);
    await tx.wait();
    log('Address authorised.', 'ok');
  }catch(err){ log('Failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('removeWhitelistBtn').addEventListener('click', async ()=>{
  const addr = document.getElementById('whitelistAddr').value.trim();
  try{
    const tx = await contract.removeAuthorisedRegistrant(addr);
    log(`Revoking ${addr.slice(0,8)}… — tx ${tx.hash.slice(0,10)}…`);
    await tx.wait();
    log('Address revoked.', 'ok');
  }catch(err){ log('Failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('approveBtn').addEventListener('click', async ()=>{
  const stallId = document.getElementById('approvalStallId').value;
  try{
    const tx = await contract.approveStall(stallId);
    log(`Approving stall #${stallId} — tx ${tx.hash.slice(0,10)}…`);
    await tx.wait();
    log('Stall approved — it can now accept payments.', 'ok');
    loadStalls();
  }catch(err){ log('Approval failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('rejectBtn').addEventListener('click', async ()=>{
  const stallId = document.getElementById('approvalStallId').value;
  try{
    const tx = await contract.rejectStall(stallId);
    log(`Rejecting stall #${stallId} — tx ${tx.hash.slice(0,10)}…`);
    await tx.wait();
    log('Stall rejected.', 'ok');
    loadStalls();
  }catch(err){ log('Rejection failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('processBtn').addEventListener('click', async ()=>{
  try{
    const tx = await contract.processCarnivalEnd();
    log(`Processing carnival end-of-day — tx ${tx.hash.slice(0,10)}…`);
    await tx.wait();
    log('Carnival processed. Withdrawals open 24h from now.', 'ok');
  }catch(err){ log('Failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('setRootBtn').addEventListener('click', async ()=>{
  const root = document.getElementById('rootInput').value.trim();
  if(!/^0x[0-9a-fA-F]{64}$/.test(root)){
    log('Root must be a 0x-prefixed 32-byte hex value.', 'err');
    return;
  }
  try{
    const tx = await contract.setEligibilityRoot(root);
    log(`Publishing eligibility root ${root.slice(0,10)}… — tx ${tx.hash.slice(0,10)}…`);
    await tx.wait();
    log('Eligibility root published.', 'ok');
  }catch(err){ log('Failed: ' + (err.reason || err.message || err), 'err'); }
});
