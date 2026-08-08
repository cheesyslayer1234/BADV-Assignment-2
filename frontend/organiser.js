/**
 * organiser.js — page logic for organiser.html (Organiser Desk).
 * Requires wallet.js to be loaded first.
 *
 * Anyone can open this page. What they see depends on their wallet:
 *   - no wallet connected      -> "connect your wallet" gate
 *   - connected, not organiser -> inline "sorry, not the organiser" message
 *   - connected, is organiser  -> the actual admin tools
 */

function showState(id){
  ['checkingState','noWalletState','notOrganiserState','organiserTools'].forEach(s=>{
    document.getElementById(s).style.display = (s===id) ? (s==='organiserTools' ? 'block' : 'block') : 'none';
  });
}

document.getElementById('gateConnectBtn').addEventListener('click', connectWallet);

document.addEventListener('wallet:unavailable', ()=> showState('noWalletState'));
document.addEventListener('wallet:disconnected', ()=> showState('noWalletState'));

document.addEventListener('wallet:ready', async ()=>{
  try{
    const organiserAddr = await contract.organiser();
    if(organiserAddr.toLowerCase() === userAddress.toLowerCase()){
      showState('organiserTools');
    }else{
      document.getElementById('connectedAddrDisplay').textContent = userAddress;
      showState('notOrganiserState');
    }
  }catch(err){
    log('Could not verify organiser: ' + (err.reason || err.message || err), 'err');
    showState('notOrganiserState');
  }
});

document.getElementById('approveBtn').addEventListener('click', async ()=>{
  const stallId = document.getElementById('approvalStallId').value;
  try{
    const tx = await contract.approveStall(stallId);
    log(`Approving stall #${stallId}…`);
    await tx.wait();
    log('Stall approved — it can now accept payments.', 'ok');
  }catch(err){ log('Approval failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('rejectBtn').addEventListener('click', async ()=>{
  const stallId = document.getElementById('approvalStallId').value;
  try{
    const tx = await contract.rejectStall(stallId);
    log(`Rejecting stall #${stallId}…`);
    await tx.wait();
    log('Stall rejected.', 'ok');
  }catch(err){ log('Rejection failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('addWhitelistBtn').addEventListener('click', async ()=>{
  const addr = document.getElementById('whitelistAddr').value.trim();
  try{
    const tx = await contract.addAuthorisedRegistrant(addr);
    log(`Authorising ${addr.slice(0,8)}…`);
    await tx.wait();
    log('Address authorised.', 'ok');
  }catch(err){ log('Failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('removeWhitelistBtn').addEventListener('click', async ()=>{
  const addr = document.getElementById('whitelistAddr').value.trim();
  try{
    const tx = await contract.removeAuthorisedRegistrant(addr);
    log(`Revoking ${addr.slice(0,8)}…`);
    await tx.wait();
    log('Address revoked.', 'ok');
  }catch(err){ log('Failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('processBtn').addEventListener('click', async ()=>{
  try{
    const tx = await contract.processCarnivalEnd();
    log('Processing carnival end-of-day…');
    await tx.wait();
    log('Carnival processed. Withdrawals open 24h from now.', 'ok');
  }catch(err){ log('Failed: ' + (err.reason || err.message || err), 'err'); }
});

document.getElementById('setRootBtn').addEventListener('click', async ()=>{
  const root = document.getElementById('rootInput').value.trim();
  if(!/^0x[0-9a-fA-F]{64}$/.test(root)){
    log('Root must be a 0x-prefixed 32-byte hex value.', 'err');
    return;
  }
  try{
    const tx = await contract.setEligibilityRoot(root);
    log(`Publishing eligibility root ${root.slice(0,10)}…`);
    await tx.wait();
    log('Eligibility root published.', 'ok');
  }catch(err){ log('Failed: ' + (err.reason || err.message || err), 'err'); }
});
