/**
 * manage.js — page logic for manage.html (My Stall Tools).
 * Requires wallet.js to be loaded first.
 *
 * Anyone can open this page. What they see depends on their wallet:
 *   - no wallet connected        -> "connect your wallet" gate
 *   - connected, owns no stall   -> inline "you don't own a stall" message
 *   - connected, owns a stall    -> the refund/withdraw tools + their stall list
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
      renderMyStalls(myStalls);
      showState('ownerTools');
    }else{
      document.getElementById('connectedAddrDisplay').textContent = userAddress;
      showState('notOwnerState');
    }
  }catch(err){
    log('Could not check stall ownership: ' + (err.reason || err.message || err), 'err');
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

function renderMyStalls(myStalls){
  const statusNames = ['None', 'Pending', 'Approved', 'Rejected'];
  const statusClasses = ['', 'status-pending', 'status-approved', 'status-rejected'];
  const list = document.getElementById('myStallsList');
  list.innerHTML = '';
  myStalls.forEach(s=>{
    const status = Number(s.status);
    const card = document.createElement('div');
    card.className = 'stall-card';
    card.innerHTML = `
      <div class="id-tag">STALL #${s.id}</div>
      <span class="status-badge ${statusClasses[status]}">${statusNames[status]}</span>
      <h3>${s.name}</h3>
      <div class="meta"><span>Balance</span><b>${ethers.formatEther(s.balance)} ETH</b></div>
      <div class="meta"><span>Total received</span><b>${ethers.formatEther(s.totalPaid)} ETH</b></div>
      ${s.withdrawn ? '<p class="hint">Already withdrawn.</p>' : ''}
    `;
    list.appendChild(card);
  });
}

document.getElementById('refundBtn').addEventListener('click', async ()=>{
  if(!contract){ log('Connect your wallet first.', 'err'); return; }
  const stallId = document.getElementById('refundStallId').value;
  const payer = document.getElementById('refundPayer').value.trim();
  const amount = document.getElementById('refundAmount').value;
  try{
    const tx = await contract.issueRefund(stallId, payer, ethers.parseEther(amount));
    log(`Refunding ${amount} ETH to ${payer.slice(0,8)}…`);
    await tx.wait();
    log('Refund sent.', 'ok');
  }catch(err){ log('Refund failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('withdrawBtn').addEventListener('click', async ()=>{
  if(!contract){ log('Connect your wallet first.', 'err'); return; }
  const stallId = document.getElementById('withdrawStallId').value;
  try{
    const tx = await contract.withdrawFunds(stallId);
    log(`Withdrawing funds for stall #${stallId}…`);
    await tx.wait();
    log('Withdrawal complete.', 'ok');
  }catch(err){ log('Withdrawal failed: ' + (err.reason || err.message || err), 'err'); }
});
