/**
 * apply.js — page logic for apply.html (Apply for a Stall).
 * Requires wallet.js and merkle.js to be loaded first.
 *
 * Eligibility check flow — entirely automatic, applicant never sees or
 * touches raw proof data:
 *   1. Fetch frontend/generated/eligible-registrants.json — the plain,
 *      public list of eligible addresses the organiser maintains from the
 *      Organiser Desk.
 *   2. Build the Merkle tree client-side (merkle.js) and, if this wallet
 *      is in the list, compute its proof.
 *   3. Ask the contract to confirm that proof actually verifies against
 *      whatever root is currently published on-chain (guards against the
 *      list having gone stale since the organiser last published).
 *   4. If any of that fails to turn up a valid proof, tell the applicant
 *      plainly they're not on the list yet. If the check itself couldn't
 *      even run (e.g. the list file was unreachable), say so and offer a
 *      retry — never fall back to a manual paste box.
 *
 * currentProof holds whatever proof (if any) was auto-detected for the
 * connected wallet, and is what actually gets submitted with the
 * application — the applicant only ever fills in the stall name.
 */

let currentProof = [];

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

  try{
    const res = await fetch('generated/eligible-registrants.json');
    if(!res.ok){ showCouldNotCheck(); return; }
    const data = await res.json();
    const addresses = Array.isArray(data) ? data : data.addresses;
    if(!Array.isArray(addresses)){ showCouldNotCheck(); return; }

    const tree = Merkle.buildTree(addresses);
    const proof = Merkle.getProof(tree, userAddress);
    if(!proof){ showNotEligible(); return; }

    const validOnChain = await contract.isEligibleByProof(userAddress, proof);
    if(validOnChain){
      currentProof = proof;
      showEligible();
    }else{
      // List is stale (organiser published a newer root since this file
      // was last updated) — this wallet just isn't on the current list.
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
