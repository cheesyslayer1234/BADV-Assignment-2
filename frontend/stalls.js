/**
 * stalls.js — page logic for index.html (Stalls & Payments).
 * Requires wallet.js to be loaded first.
 */

document.addEventListener('wallet:ready', ()=>{
  loadStalls();
  tryAutoFillProof();
});
document.addEventListener('wallet:disconnected', ()=>{
  document.getElementById('stallGrid').innerHTML =
    '<p class="empty-state">Connect your wallet to load stalls.</p>';
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

async function loadStalls(){
  if(!contract) return;
  const grid = document.getElementById('stallGrid');
  grid.innerHTML = '<p class="empty-state"><span class="spinner"></span>&nbsp; Loading stalls…</p>';
  try{
    const count = await contract.stallCount();
    grid.innerHTML = '';
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
            log(`Paying stall #${i}: ${amt} ETH…`);
            await tx.wait();
            log(`Payment confirmed for stall #${i}.`, 'ok');
            loadStalls();
          }catch(err){ log('Payment failed: ' + (err.reason || err.message || err), 'err'); }
        });
      }

      grid.appendChild(card);
    }
    if(Number(count)===0){
      grid.innerHTML = '<p class="empty-state">No stalls registered yet.</p>';
    }
  }catch(err){
    grid.innerHTML = '<p class="empty-state">Could not load stalls.</p>';
    log('Could not load stalls: ' + (err.reason || err.message || err), 'err');
  }
}
document.getElementById('refreshBtn').addEventListener('click', loadStalls);

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
    loadStalls();
  }catch(err){ log('Registration failed: ' + (err.reason || err.message || err), 'err'); }
});
