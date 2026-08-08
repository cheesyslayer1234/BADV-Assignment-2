/**
 * apply.js — page logic for apply.html (Apply for a Stall).
 * Requires wallet.js to be loaded first.
 */

document.addEventListener('wallet:ready', ()=>{
  tryAutoFillProof();
  loadMyApplications();
});
document.addEventListener('wallet:disconnected', ()=>{
  document.getElementById('myApplicationsList').innerHTML =
    '<p class="empty-state">Connect your wallet to see your applications.</p>';
});

async function tryAutoFillProof(){
  // Optional convenience: if this page is served alongside
  // generated/eligibility-proofs.json (produced by
  // scripts/generate-merkle-root.js), auto-fill the connected wallet's
  // proof so they don't have to paste it manually. Silently does nothing
  // if the file isn't reachable.
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
    log(`Registering "${name}"…`);
    await tx.wait();
    log('Stall registered.', 'ok');
    document.getElementById('stallNameInput').value = '';
    document.getElementById('proofInput').value = '';
    loadMyApplications();
  }catch(err){ log('Registration failed: ' + (err.reason || err.message || err), 'err'); }
});
