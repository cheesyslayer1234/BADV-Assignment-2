/**
 * organiser.js — page logic for organiser.html (Organiser Desk).
 * Requires wallet.js to be loaded first.
 *
 * Anyone can open this page. What they see depends on their wallet:
 *   - no wallet connected      -> "connect your wallet" gate
 *   - connected, not organiser -> inline "sorry, not the organiser" message
 *   - connected, is organiser  -> the actual admin tools
 *
 * Pending/decided stalls are fetched from the contract and rendered as
 * clickable cards, so the organiser never has to know or type a stall ID.
 */

const STATUS_NAMES = ['None', 'Pending', 'Approved', 'Rejected'];
const STATUS_CLASSES = ['', 'status-pending', 'status-approved', 'status-rejected'];

function showState(id){
  ['checkingState','noWalletState','notOrganiserState','organiserTools'].forEach(s=>{
    document.getElementById(s).style.display = (s===id) ? (s==='organiserTools' ? 'block' : 'block') : 'none';
  });
}

document.getElementById('gateConnectBtn').addEventListener('click', connectWallet);

document.addEventListener('wallet:unavailable', ()=> showState('noWalletState'));
document.addEventListener('wallet:disconnected', ()=> showState('noWalletState'));

document.addEventListener('wallet:ready', async ()=>{
  try{
    const organiserAddr = await contract.organiser();
    if(organiserAddr.toLowerCase() === userAddress.toLowerCase()){
      showState('organiserTools');
      loadStalls();
      loadCurrentRoot();
    }else{
      document.getElementById('connectedAddrDisplay').textContent = userAddress;
      showState('notOrganiserState');
    }
  }catch(err){
    log('Could not verify organiser: ' + (err.reason || err.message || err), 'err');
    showState('notOrganiserState');
  }
});

function formatWhen(unixSeconds){
  const n = Number(unixSeconds);
  if(!n) return '';
  return new Date(n * 1000).toLocaleString();
}

function renderPendingCard(s){
  const card = document.createElement('div');
  card.className = 'review-card';
  card.innerHTML = `
    <div class="review-info">
      <div class="id-tag">STALL #${s.id}</div>
      <h4>${s.name}</h4>
      <div class="owner">${s.owner}</div>
      <div class="applied-at">Applied ${formatWhen(s.appliedAt)}</div>
    </div>
    <div class="actions">
      <button class="primary approve-btn">Approve</button>
      <button class="danger reject-btn">Reject</button>
    </div>
  `;
  card.querySelector('.approve-btn').addEventListener('click', async (e)=>{
    e.target.disabled = true;
    try{
      const tx = await contract.approveStall(s.id);
      log(`Approving stall #${s.id} ("${s.name}")…`);
      await tx.wait();
      log('Stall approved — it can now accept payments.', 'ok');
      loadStalls();
    }catch(err){
      log('Approval failed: ' + (err.reason || err.message || err), 'err');
      e.target.disabled = false;
    }
  });
  card.querySelector('.reject-btn').addEventListener('click', async (e)=>{
    e.target.disabled = true;
    try{
      const tx = await contract.rejectStall(s.id);
      log(`Rejecting stall #${s.id} ("${s.name}")…`);
      await tx.wait();
      log('Stall rejected.', 'ok');
      loadStalls();
    }catch(err){
      log('Rejection failed: ' + (err.reason || err.message || err), 'err');
      e.target.disabled = false;
    }
  });
  return card;
}

function renderDecidedCard(s){
  const status = Number(s.status);
  const card = document.createElement('div');
  card.className = 'stall-card';
  card.innerHTML = `
    <div class="id-tag">STALL #${s.id}</div>
    <span class="status-badge ${STATUS_CLASSES[status]}">${STATUS_NAMES[status]}</span>
    <h3>${s.name}</h3>
    <div class="owner">${s.owner}</div>
    <p class="hint">${status===2 ? `Approved ${formatWhen(s.decidedAt)}` : `Rejected ${formatWhen(s.decidedAt)}`}</p>
  `;
  return card;
}

async function loadStalls(){
  const pendingList = document.getElementById('pendingList');
  const decidedList = document.getElementById('decidedList');
  pendingList.innerHTML = '<p class="empty-state"><span class="spinner"></span>&nbsp; Loading applications…</p>';
  try{
    const count = await contract.stallCount();
    const pending = [];
    const decided = [];
    for(let i=0; i<Number(count); i++){
      const raw = await contract.getStall(i);
      const s = { id: i, ...raw };
      if(Number(s.status) === 1) pending.push(s);
      else decided.push(s);
    }

    pendingList.innerHTML = '';
    if(pending.length === 0){
      pendingList.innerHTML = '<p class="empty-state">No pending applications right now.</p>';
    }else{
      pending.forEach(s=> pendingList.appendChild(renderPendingCard(s)));
    }

    decidedList.innerHTML = '';
    if(decided.length === 0){
      decidedList.innerHTML = '<p class="empty-state">No decided stalls yet.</p>';
    }else{
      const grid = document.createElement('div');
      grid.className = 'stall-grid';
      decided.forEach(s=> grid.appendChild(renderDecidedCard(s)));
      decidedList.appendChild(grid);
    }
  }catch(err){
    pendingList.innerHTML = '<p class="empty-state">Could not load applications.</p>';
    log('Could not load stalls: ' + (err.reason || err.message || err), 'err');
  }
}
document.getElementById('refreshStallsBtn').addEventListener('click', loadStalls);

document.getElementById('decidedToggle').addEventListener('click', (e)=>{
  const list = document.getElementById('decidedList');
  const expanded = list.style.display !== 'none';
  list.style.display = expanded ? 'none' : 'block';
  e.currentTarget.setAttribute('aria-expanded', String(!expanded));
});

document.getElementById('addWhitelistBtn').addEventListener('click', async ()=>{
  const addr = document.getElementById('whitelistAddr').value.trim();
  try{
    const tx = await contract.addAuthorisedRegistrant(addr);
    log(`Authorising ${addr.slice(0,8)}…`);
    await tx.wait();
    log('Address authorised.', 'ok');
  }catch(err){ log('Failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('removeWhitelistBtn').addEventListener('click', async ()=>{
  const addr = document.getElementById('whitelistAddr').value.trim();
  try{
    const tx = await contract.removeAuthorisedRegistrant(addr);
    log(`Revoking ${addr.slice(0,8)}…`);
    await tx.wait();
    log('Address revoked.', 'ok');
  }catch(err){ log('Failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('processBtn').addEventListener('click', async ()=>{
  try{
    const tx = await contract.processCarnivalEnd();
    log('Processing carnival end-of-day…');
    await tx.wait();
    log('Carnival processed. Withdrawals open 24h from now.', 'ok');
  }catch(err){ log('Failed: ' + (err.reason || err.message || err), 'err'); }
});

async function loadCurrentRoot(){
  const el = document.getElementById('currentRootDisplay');
  try{
    const root = await contract.eligibleRegistrantsRoot();
    const isZero = /^0x0+$/.test(root);
    el.value = isZero ? 'Not published yet' : root;
  }catch(err){
    el.value = '—';
  }
}

document.getElementById('setRootBtn').addEventListener('click', async ()=>{
  const root = document.getElementById('rootInput').value.trim();
  if(!/^0x[0-9a-fA-F]{64}$/.test(root)){
    log('That doesn\'t look like a full root — paste exactly what generate-merkle-root.js printed.', 'err');
    return;
  }
  try{
    const tx = await contract.setEligibilityRoot(root);
    log(`Publishing eligibility root ${root.slice(0,10)}…`);
    await tx.wait();
    log('Eligibility root published.', 'ok');
    document.getElementById('rootInput').value = '';
    loadCurrentRoot();
  }catch(err){ log('Failed: ' + (err.reason || err.message || err), 'err'); }
});
