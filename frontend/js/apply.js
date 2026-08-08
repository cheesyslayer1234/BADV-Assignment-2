/**
 * apply.js — page logic for apply.html (Apply for a Stall).
 * Requires wallet.js to be loaded first.
 *
 * Eligibility check flow — entirely automatic, applicant never sees or
 * touches raw proof data:
 *   1. Ask the contract if this wallet is on the organiser's whitelist.
 *   2. If not, fetch frontend/generated/eligibility-proofs.json (written
 *      by `npm run generate-merkle-root`) and see if it has a proof for
 *      this wallet. If so, ask the contract to confirm that proof is
 *      actually valid against the published root.
 *   3. If neither path works, tell the applicant plainly they're not on
 *      the list yet. If the check itself couldn't even run (e.g. the
 *      eligibility file was unreachable), say so and offer a retry —
 *      never fall back to a manual paste box.
 *
 * currentProof holds whatever proof (if any) was auto-detected for the
 * connected wallet, and is what actually gets submitted with the
 * application — the applicant only ever fills in the stall name.
 */

let currentProof = []; // [] = registering via whitelist, non-empty = via Merkle proof

document.addEventListener('wallet:ready', ()=>{
  checkEligibility();
  loadMyApplications();
});
document.addEventListener('wallet:disconnected', ()=>{
  document.getElementById('myApplicationsList').innerHTML =
    '<p class="empty-state">Connect your wallet to see your applications.</p>';
  resetEligibilityBanners();
});

function resetEligibilityBanners(){
  document.getElementById('eligChecking').style.display = 'block';
  document.getElementById('eligYes').style.display = 'none';
  document.getElementById('eligNo').style.display = 'none';
  document.getElementById('eligUnknown').style.display = 'none';
  document.getElementById('applyForm').style.display = 'none';
}

function showEligible(){
  resetEligibilityBanners();
  document.getElementById('eligChecking').style.display = 'none';
  document.getElementById('eligYes').style.display = 'block';
  document.getElementById('applyForm').style.display = 'block';
}

function showNotEligible(){
  resetEligibilityBanners();
  document.getElementById('eligChecking').style.display = 'none';
  document.getElementById('eligNo').style.display = 'block';
  document.getElementById('notEligibleAddr').textContent = userAddress;
}

function showCouldNotCheck(){
  resetEligibilityBanners();
  document.getElementById('eligChecking').style.display = 'none';
  document.getElementById('eligUnknown').style.display = 'block';
}

document.getElementById('retryEligBtn').addEventListener('click', checkEligibility);

async function checkEligibility(){
  resetEligibilityBanners();
  currentProof = [];

  let whitelisted = false;
  try{
    whitelisted = await contract.isAuthorisedRegistrant(userAddress);
  }catch(err){
    // couldn't even reach the chain for this read — treat as a soft
    // failure and still try the proof-file path below before giving up.
  }
  if(whitelisted){
    showEligible();
    return;
  }

  try{
    const res = await fetch('generated/eligibility-proofs.json');
    if(!res.ok){ showCouldNotCheck(); return; }
    const data = await res.json();
    const proof = data.proofsByAddress && data.proofsByAddress[ethers.getAddress(userAddress)];
    if(!proof){ showNotEligible(); return; }
    const validOnChain = await contract.isEligibleByProof(userAddress, proof);
    if(validOnChain){
      currentProof = proof;
      showEligible();
    }else{
      // File is stale (organiser published a newer root since) — this
      // wallet just isn't on the current list.
      showNotEligible();
    }
  }catch(err){
    showCouldNotCheck();
  }
}

async function loadMyApplications(){
  if(!contract) return;
  const list = document.getElementById('myApplicationsList');
  list.innerHTML = '<p class="empty-state"><span class="spinner"></span>&nbsp; Loading…</p>';
  try{
    const count = await contract.stallCount();
    const statusNames = ['None', 'Pending', 'Approved', 'Rejected'];
    const statusClasses = ['', 'status-pending', 'status-approved', 'status-rejected'];
    const mine = [];
    for(let i=0; i<Number(count); i++){
      const s = await contract.getStall(i);
      if(s.owner.toLowerCase() === userAddress.toLowerCase()) mine.push({ id: i, ...s });
    }
    list.innerHTML = '';
    if(mine.length === 0){
      list.innerHTML = '<p class="empty-state">You haven\'t applied for a stall yet.</p>';
      return;
    }
    mine.forEach(s=>{
      const status = Number(s.status);
      const card = document.createElement('div');
      card.className = 'stall-card';
      card.innerHTML = `
        <div class="id-tag">STALL #${s.id}</div>
        <span class="status-badge ${statusClasses[status]}">${statusNames[status]}</span>
        <h3>${s.name}</h3>
        <p class="hint">${status===1 ? 'Awaiting organiser approval.' : status===2 ? 'Approved — visible on the Browse & Pay page.' : status===3 ? 'This application was rejected.' : ''}</p>
      `;
      list.appendChild(card);
    });
  }catch(err){
    list.innerHTML = '<p class="empty-state">Could not load your applications.</p>';
    log('Could not load applications: ' + (err.reason || err.message || err), 'err');
  }
}

document.getElementById('registerBtn').addEventListener('click', async ()=>{
  if(!contract){ log('Connect your wallet first.', 'err'); return; }
  const name = document.getElementById('stallNameInput').value.trim();
  if(!name){ log('Enter a stall name first.', 'err'); return; }

  try{
    const tx = await contract.registerStall(name, currentProof);
    log(`Registering "${name}"…`);
    await tx.wait();
    log('Stall registered.', 'ok');
    document.getElementById('stallNameInput').value = '';
    loadMyApplications();
  }catch(err){ log('Registration failed: ' + (err.reason || err.message || err), 'err'); }
});
