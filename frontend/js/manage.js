/**
 * manage.js — page logic for manage.html (My Stall Tools).
 * Requires wallet.js to be loaded first.
 *
 * Anyone can open this page. What they see depends on their wallet:
 *   - no wallet connected        -> "connect your wallet" gate
 *   - connected, owns no stall   -> inline "you don't own a stall" message
 *   - connected, owns a stall    -> refund/withdraw controls on each stall's own card
 *
 * Refund and withdraw actions live directly on each stall's card, bound
 * to that stall's ID via closure — nobody has to know or type a stall ID.
 */

function showState(id){
  ['checkingState','noWalletState','notOwnerState','ownerTools'].forEach(s=>{
    document.getElementById(s).style.display = (s===id) ? 'block' : 'none';
  });
}

document.getElementById('gateConnectBtn').addEventListener('click', connectWallet);

document.addEventListener('wallet:unavailable', ()=> showState('noWalletState'));
document.addEventListener('wallet:disconnected', ()=> showState('noWalletState'));

document.addEventListener('wallet:ready', async ()=>{
  try{
    const myStalls = await findMyStalls();
    if(myStalls.length > 0){
      await renderMyStalls(myStalls);
      showState('ownerTools');
    }else{
      document.getElementById('connectedAddrDisplay').textContent = userAddress;
      showState('notOwnerState');
    }
  }catch(err){
    log('Could not check stall ownership: ' + friendlyError(err), 'err');
    showState('notOwnerState');
  }
});

async function findMyStalls(){
  const count = await contract.stallCount();
  const mine = [];
  for(let i=0; i<Number(count); i++){
    const s = await contract.getStall(i);
    if(s.owner.toLowerCase() === userAddress.toLowerCase()){
      mine.push({ id: i, ...s });
    }
  }
  return mine;
}

async function renderMyStalls(myStalls){
  const statusNames = ['None', 'Pending', 'Approved', 'Rejected'];
  const statusClasses = ['', 'status-pending', 'status-approved', 'status-rejected'];
  const list = document.getElementById('myStallsList');
  list.innerHTML = '';

  let withdrawalWindowOpen = false;
  try{ withdrawalWindowOpen = await contract.isWithdrawalWindowOpen(); }catch(err){ console.error(err); /* default false */ }

  myStalls.forEach(s=>{
    const status = Number(s.status);
    const card = document.createElement('div');
    card.className = 'stall-card';

    let actionsHtml = '';
    if(status === 2){ // Approved — only approved stalls can hold/refund/withdraw balance
      const canWithdraw = withdrawalWindowOpen && Number(s.balance) > 0 && !s.withdrawn;
      actionsHtml = `
        <div class="stall-actions">
          <div class="field-row">
            <div class="field"><label>Payer address</label><input class="refund-payer" placeholder="0x..." /></div>
            <div class="field"><label>Amount (ETH)</label><input class="refund-amount" placeholder="0.1" /></div>
          </div>
          <div class="actions">
            <button class="ghost refund-btn">Refund this customer</button>
            <button class="primary withdraw-btn" ${canWithdraw ? '' : 'disabled'}>Withdraw funds</button>
          </div>
          ${s.withdrawn ? '<p class="hint">Already withdrawn.</p>' :
            (!withdrawalWindowOpen ? '<p class="hint">Withdrawals open once the organiser processes the carnival close-out, plus one further day.</p>' :
             Number(s.balance) === 0 ? '<p class="hint">Nothing to withdraw yet.</p>' : '')}
        </div>
      `;
    } else if(status === 3){ // Rejected — owner can edit and resubmit
      actionsHtml = `
        <div class="stall-actions">
          <div class="field"><label>Updated stall name</label><input class="resubmit-name" value="${s.name}" /></div>
          <div class="actions">
            <button class="primary resubmit-btn">Resubmit application</button>
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="id-tag">STALL #${s.id}</div>
      <span class="status-badge ${statusClasses[status]}">${statusNames[status]}</span>
      <h3>${s.name}</h3>
      <div class="meta"><span>Balance</span><b>${ethers.formatEther(s.balance)} ETH</b></div>
      <div class="meta"><span>Total received</span><b>${ethers.formatEther(s.totalPaid)} ETH</b></div>
      ${status===1 ? '<p class="hint">Awaiting organiser approval.</p>' : ''}
      ${status===3 ? `<p class="hint">Rejected — reason: ${s.rejectionReason}</p>` : ''}
      ${actionsHtml}
    `;

    if(status === 2){
      card.querySelector('.refund-btn').addEventListener('click', async ()=>{
        const payer = card.querySelector('.refund-payer').value.trim();
        const amount = card.querySelector('.refund-amount').value;
        if(!payer || !amount){ log('Enter a payer address and an amount first.', 'err'); return; }
        try{
          const tx = await contract.issueRefund(s.id, payer, ethers.parseEther(amount));
          log(`Refunding ${amount} ETH to ${payer.slice(0,8)}… from stall #${s.id}`);
          await tx.wait();
          log('Refund sent.', 'ok');
          document.dispatchEvent(new CustomEvent('wallet:ready')); // cheap way to re-fetch balances
        }catch(err){ log('Refund failed: ' + friendlyError(err), 'err'); }
      });

      const withdrawBtn = card.querySelector('.withdraw-btn');
      withdrawBtn.addEventListener('click', async ()=>{
        withdrawBtn.disabled = true;
        try{
          const tx = await contract.withdrawFunds(s.id);
          log(`Withdrawing funds for stall #${s.id}…`);
          await tx.wait();
          log('Withdrawal complete.', 'ok');
          document.dispatchEvent(new CustomEvent('wallet:ready'));
        }catch(err){
          log('Withdrawal failed: ' + friendlyError(err), 'err');
          withdrawBtn.disabled = false;
        }
      });
    }

    if(status === 3){
      card.querySelector('.resubmit-btn').addEventListener('click', async (e)=>{
        const newName = card.querySelector('.resubmit-name').value.trim();
        if(!newName){ log('Enter a stall name before resubmitting.', 'err'); return; }
        e.target.disabled = true;
        try{
          const tx = await contract.resubmitStall(s.id, newName);
          log(`Resubmitting stall #${s.id}…`);
          await tx.wait();
          log('Application resubmitted — awaiting organiser review.', 'ok');
          document.dispatchEvent(new CustomEvent('wallet:ready'));
        }catch(err){
          log('Resubmission failed: ' + friendlyError(err), 'err');
          e.target.disabled = false;
        }
      });
    }

    list.appendChild(card);
  });
}
