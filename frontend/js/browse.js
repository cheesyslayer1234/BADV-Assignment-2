/**
 * browse.js — page logic for browse.html (Browse & Pay Stalls).
 * Requires wallet.js to be loaded first.
 */

document.addEventListener('wallet:ready', loadStalls);
document.addEventListener('wallet:disconnected', ()=>{
  document.getElementById('stallGrid').innerHTML =
    '<p class="empty-state">Connect your wallet to load stalls.</p>';
});

async function loadStalls(){
  if(!contract) return;
  const grid = document.getElementById('stallGrid');
  grid.innerHTML = '<p class="empty-state"><span class="spinner"></span>&nbsp; Loading stalls…</p>';
  try{
    const count = await contract.stallCount();
    grid.innerHTML = '';
    for(let i=0; i<Number(count); i++){
      const s = await contract.getStall(i);

      const statusNames = ['None', 'Pending', 'Approved', 'Rejected', 'Cancelled'];
      const statusClasses = ['', 'status-pending', 'status-approved', 'status-rejected', 'status-cancelled'];
      const status = Number(s.status);
      const isApproved = status === 2;

      let disabledHint = 'This application was rejected and cannot accept payments.';
      if(status === 1) disabledHint = 'Awaiting organiser approval — payments are disabled until then.';
      else if(status === 4) disabledHint = 'This stall was cancelled by its owner and cannot accept payments.';

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
    if(Number(count)===0){
      grid.innerHTML = '<p class="empty-state">No stalls registered yet.</p>';
    }
  }catch(err){
    grid.innerHTML = '<p class="empty-state">Could not load stalls.</p>';
    log('Could not load stalls: ' + friendlyError(err), 'err');
  }
}
document.getElementById('refreshBtn').addEventListener('click', loadStalls);
