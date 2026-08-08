/**
 * transparency.js — page logic for transparency.html (Transparency Dashboard).
 *
 * Deliberately does NOT reuse wallet.js: this page must show real numbers
 * to someone with no wallet installed and no intention of connecting one.
 * It builds its own read-only ethers provider instead of a signer, so
 * every call here is a free `eth_call`, never a transaction.
 */

const READ_ABI = [
  "function getCarnivalStats() view returns (uint256 stallCount, uint256 pendingCount, uint256 approvedCount, uint256 rejectedCount, uint256 totalRaised, uint256 totalRefunded, uint256 totalWithdrawn, bool carnivalProcessed, uint256 carnivalEndTime)",
  "function auditBalance() view returns (bool balanced, uint256 expectedBalance, uint256 actualBalance)"
];

const EXPLORER_BASE_BY_NETWORK = {
  sepolia: "https://sepolia.etherscan.io/address/",
};

function paintChrome(){
  const shortAddr = CONTRACT_ADDRESS.slice(0,6) + '…' + CONTRACT_ADDRESS.slice(-4);
  const a = document.getElementById('contractAddrShort');
  const b = document.getElementById('drawerContractAddr');
  const n = document.getElementById('networkName');
  if(a) a.textContent = shortAddr;
  if(b) b.textContent = shortAddr;
  if(n) n.textContent = CONTRACT_NETWORK;

  const explorerBase = EXPLORER_BASE_BY_NETWORK[CONTRACT_NETWORK];
  const wrap = document.getElementById('explorerLinkWrap');
  if(wrap && explorerBase){
    wrap.innerHTML = ` · <a href="${explorerBase}${CONTRACT_ADDRESS}#readContract" target="_blank" rel="noopener">View & verify on Etherscan ↗</a>`;
  }
}

/** Builds a read-only provider. Tries an injected wallet first (works even
 *  without connecting — reads don't need permission); falls back to a
 *  public default provider for known public networks so this page still
 *  works with zero browser extensions installed. Local Hardhat networks
 *  have no public RPC, so those require an injected provider pointed at
 *  localhost. */
async function getReadOnlyContract(){
  const pill = document.getElementById('readStatusPill');

  if(window.ethereum){
    try{
      const provider = new ethers.BrowserProvider(window.ethereum);
      const net = await provider.getNetwork();
      if(pill){
        pill.textContent = 'Reading via connected browser wallet';
        pill.classList.add('is-connected');
      }
      return new ethers.Contract(CONTRACT_ADDRESS, READ_ABI, provider);
    }catch(err){
      // fall through to public provider
    }
  }

  if(CONTRACT_NETWORK && CONTRACT_NETWORK !== 'localhost' && CONTRACT_NETWORK !== 'hardhat'){
    try{
      const provider = ethers.getDefaultProvider(CONTRACT_NETWORK);
      if(pill){
        pill.textContent = 'Reading via public ' + CONTRACT_NETWORK + ' RPC — no wallet needed';
        pill.classList.add('is-connected');
      }
      return new ethers.Contract(CONTRACT_ADDRESS, READ_ABI, provider);
    }catch(err){
      // fall through to error state below
    }
  }

  if(pill){
    pill.textContent = 'Could not reach the chain';
    pill.classList.add('is-error');
  }
  return null;
}

function fmtEth(wei){
  return ethers.formatEther(wei) + ' ETH';
}

async function loadDashboard(){
  const statGrid = document.getElementById('statGrid');
  const auditWrap = document.getElementById('auditWrap');
  const statusBreakdown = document.getElementById('statusBreakdown');

  const contract = await getReadOnlyContract();
  if(!contract){
    const msg = '<p class="empty-state">Could not read the chain — if this contract is on a local Hardhat network, open this page with a browser wallet pointed at localhost.</p>';
    statGrid.innerHTML = msg;
    auditWrap.innerHTML = msg;
    statusBreakdown.innerHTML = msg;
    return;
  }

  try{
    const stats = await contract.getCarnivalStats();
    const netRaised = stats.totalRaised - stats.totalRefunded - stats.totalWithdrawn;

    statGrid.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Total raised, all-time</div>
        <div class="stat-value">${fmtEth(stats.totalRaised)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total refunded</div>
        <div class="stat-value">${fmtEth(stats.totalRefunded)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total withdrawn by stalls</div>
        <div class="stat-value">${fmtEth(stats.totalWithdrawn)}</div>
      </div>
      <div class="stat-card stat-gold">
        <div class="stat-label">Currently held by contract</div>
        <div class="stat-value">${fmtEth(netRaised)}</div>
      </div>
      <div class="stat-card stat-green">
        <div class="stat-label">Total stalls registered</div>
        <div class="stat-value">${stats.stallCount.toString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Carnival status</div>
        <div class="stat-value" style="font-size:15px;">${stats.carnivalProcessed ? 'Closed out ✓' : 'In progress'}</div>
      </div>
    `;

    statusBreakdown.innerHTML = `
      <div class="status-breakdown-grid">
        <div class="stat-card">
          <div class="stat-label">Pending</div>
          <div class="stat-value">${stats.pendingCount.toString()}</div>
        </div>
        <div class="stat-card stat-green">
          <div class="stat-label">Approved</div>
          <div class="stat-value">${stats.approvedCount.toString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Rejected</div>
          <div class="stat-value">${stats.rejectedCount.toString()}</div>
        </div>
      </div>
    `;

    const audit = await contract.auditBalance();
    const balanced = audit.balanced;
    auditWrap.innerHTML = `
      <div class="audit-badge ${balanced ? 'audit-ok' : 'audit-bad'}">
        <div class="audit-icon">${balanced ? '✓' : '⚠'}</div>
        <div class="audit-text">
          <b>${balanced ? 'Bookkeeping matches the contract balance' : 'Mismatch detected — investigate'}</b>
          <span>expected ${fmtEth(audit.expectedBalance)} · actual ${fmtEth(audit.actualBalance)}</span>
        </div>
      </div>
    `;
  }catch(err){
    const msg = '<p class="empty-state">Could not read contract data: ' + (err.reason || err.message || err) + '</p>';
    statGrid.innerHTML = msg;
    auditWrap.innerHTML = msg;
    statusBreakdown.innerHTML = msg;
  }
}

function wireDrawer(){
  const menuBtn = document.getElementById('menuBtn');
  const drawer = document.getElementById('drawer');
  const backdrop = document.getElementById('drawerBackdrop');
  const closeBtn = document.getElementById('drawerClose');
  if(!menuBtn || !drawer || !backdrop) return;

  function open(){ drawer.classList.add('open'); backdrop.classList.add('open'); menuBtn.setAttribute('aria-expanded','true'); }
  function close(){ drawer.classList.remove('open'); backdrop.classList.remove('open'); menuBtn.setAttribute('aria-expanded','false'); }
  menuBtn.addEventListener('click', ()=> drawer.classList.contains('open') ? close() : open());
  backdrop.addEventListener('click', close);
  if(closeBtn) closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') close(); });
}

document.addEventListener('DOMContentLoaded', ()=>{
  paintChrome();
  wireDrawer();
  loadDashboard();
  const btn = document.getElementById('refreshStatsBtn');
  if(btn) btn.addEventListener('click', loadDashboard);
});
