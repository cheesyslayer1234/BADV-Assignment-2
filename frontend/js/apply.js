/**
 * apply.js — page logic for apply.html (Apply for a Stall).
 * Requires wallet.js to be loaded first.
 *
 * Any connected wallet can submit an application — there is no on-chain
 * eligibility gate. The organiser is the actual gatekeeper: every
 * application starts Pending and only becomes usable once they approve it
 * from the Organiser Desk.
 */

document.addEventListener('wallet:ready', ()=>{
  loadMyApplications();
});
document.addEventListener('wallet:disconnected', ()=>{
  document.getElementById('myApplicationsList').innerHTML =
    '<p class="empty-state">Connect your wallet to see your applications.</p>';
});

async function loadMyApplications(){
  if(!contract) return;
  const list = document.getElementById('myApplicationsList');
  list.innerHTML = '<p class="empty-state"><span class="spinner"></span>&nbsp; Loading…</p>';
  try{
    const count = await contract.stallCount();
    const statusNames = ['None', 'Pending', 'Approved', 'Rejected', 'Cancelled'];
    const statusClasses = ['', 'status-pending', 'status-approved', 'status-rejected', 'status-cancelled'];
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
        <p class="hint">${
          status===1 ? 'Awaiting organiser approval.' :
          status===2 ? 'Approved — visible on the Browse & Pay page.' :
          status===3 ? `Rejected — reason: ${s.rejectionReason}. Head to My Stall Tools to edit and resubmit.` :
          status===4 ? 'You cancelled this stall.' : ''
        }</p>
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
    const tx = await contract.registerStall(name);
    log(`Registering "${name}"…`);
    await tx.wait();
    log('Stall registered.', 'ok');
    document.getElementById('stallNameInput').value = '';
    loadMyApplications();
  }catch(err){ log('Registration failed: ' + (err.reason || err.message || err), 'err'); }
});
