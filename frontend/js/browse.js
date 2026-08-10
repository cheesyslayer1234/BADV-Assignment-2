
document.addEventListener('wallet:ready', loadStalls);
document.addEventListener('wallet:disconnected', ()=>{
  document.getElementById('stallGrid').innerHTML = emptyState(MESSAGES.connectToLoadStalls);
});

async function loadStalls(){
  if(!contract) return;
  const grid = document.getElementById('stallGrid');
  grid.innerHTML = emptyState(MESSAGES.loadingStalls, { spinner: true });
  try{
    const count = await contract.stallCount();
    grid.innerHTML = '';
    let shown = 0;
    for(let i=0; i<Number(count); i++){
      const s = await contract.getStall(i);

      const statusNames = ['None', 'Pending', 'Approved', 'Rejected'];
      const statusClasses = ['', 'status-pending', 'status-approved', 'status-rejected'];
      const status = Number(s.status);
      const isApproved = status === 2;

      
      
      if(status === 1) continue;
      shown++;

      const disabledHint = 'This application was rejected and cannot accept payments.';

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
        </div>` : `<p class="hint">${disabledHint}</p>`}
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
          }catch(err){ log('Payment failed: ' + friendlyError(err), 'err'); }
        });
      }

      grid.appendChild(card);
    }
    if(shown === 0){
      grid.innerHTML = emptyState(MESSAGES.noStalls);
    }
  }catch(err){
    grid.innerHTML = emptyState(MESSAGES.couldNotLoadStalls);
    log('Could not load stalls: ' + friendlyError(err), 'err');
  }
}
document.getElementById('refreshBtn').addEventListener('click', loadStalls);
