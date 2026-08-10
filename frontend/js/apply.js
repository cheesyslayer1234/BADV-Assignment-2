
document.addEventListener('wallet:ready', ()=>{
  loadMyApplications();
  refreshPendingApplicationGate();
});
document.addEventListener('wallet:disconnected', ()=>{
  document.getElementById('myApplicationsList').innerHTML =
    emptyState(MESSAGES.connectToSeeApplications);
  setRegisterFormGated(false); 
});

async function refreshPendingApplicationGate(){
  if(!contract) return { hasPending: false };
  try{
    const [hasPending, stallId] = await contract.getPendingApplication(userAddress);
    setRegisterFormGated(hasPending, hasPending ? Number(stallId) : null);
    return { hasPending, stallId: Number(stallId) };
  }catch(err){
    
    
    console.error('Could not check pending application status:', err);
    return { hasPending: false };
  }
}

function setRegisterFormGated(gated, pendingStallId){
  const btn = document.getElementById('registerBtn');
  const input = document.getElementById('stallNameInput');
  const notice = document.getElementById('pendingApplicationNotice');
  if(btn) btn.disabled = !!gated;
  if(input) input.disabled = !!gated;
  if(notice){
    if(gated){
      notice.textContent = `You already have an application pending (Stall #${pendingStallId}). ` +
        `You can submit a new one once it's approved or rejected.`;
      notice.style.display = '';
    }else{
      notice.style.display = 'none';
    }
  }
}

async function loadMyApplications(){
  if(!contract) return;
  const list = document.getElementById('myApplicationsList');
  list.innerHTML = emptyState(MESSAGES.loadingYourApplications, { spinner: true });
  try{
    const count = await contract.stallCount();
    const statusNames = ['None', 'Pending', 'Approved', 'Rejected'];
    const statusClasses = ['', 'status-pending', 'status-approved', 'status-rejected'];
    const mine = [];
    for(let i=0; i<Number(count); i++){
      const s = await contract.getStall(i);
      if(s.owner.toLowerCase() === userAddress.toLowerCase()){
        
        
        
        
        mine.push({
          id: i,
          owner: s.owner,
          name: s.name,
          balance: s.balance,
          withdrawn: s.withdrawn,
          totalPaid: s.totalPaid,
          status: s.status,
          appliedAt: s.appliedAt,
          decidedAt: s.decidedAt,
          rejectionReason: s.rejectionReason
        });
      }
    }
    list.innerHTML = '';
    if(mine.length === 0){
      list.innerHTML = emptyState(MESSAGES.noApplicationsYet);
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
          status===2 ? 'Approved - visible on the Browse & Pay page.' :
          status===3 ? `Rejected - reason: ${s.rejectionReason}. Head to My Stall Tools to edit and resubmit.` : ''
        }</p>
      `;
      list.appendChild(card);
    });
  }catch(err){
    list.innerHTML = emptyState(MESSAGES.couldNotLoadYourApplications);
    log('Could not load applications: ' + friendlyError(err), 'err');
  }
}

document.getElementById('registerBtn').addEventListener('click', async ()=>{
  if(!contract){ log('Connect your wallet first.', 'err'); return; }
  const name = document.getElementById('stallNameInput').value.trim();
  if(!name){ log('Enter a stall name first.', 'err'); return; }

  
  
  
  const gate = await refreshPendingApplicationGate();
  if(gate.hasPending){
    log(MESSAGES.alreadyHasPendingApplication, 'err');
    return;
  }

  try{
    const tx = await contract.registerStall(name);
    log(`Registering "${name}"…`);
    await tx.wait();
    log('Stall registered.', 'ok');
    document.getElementById('stallNameInput').value = '';
    loadMyApplications();
    refreshPendingApplicationGate();
  }catch(err){
    log('Registration failed: ' + friendlyError(err), 'err');
    refreshPendingApplicationGate();
  }
});
