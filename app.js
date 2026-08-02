const CONTRACT_ADDRESS = "0x146f4b9aE4DbD9Cb0fb2EEfc7dE1a6550d4df831";
const CONTRACT_ABI = [
    "function getAllProducts() public view returns (tuple(uint256 id, string name, uint256 price)[])",
    "function buyProduct(uint256 _id) public payable"
];
let provider, signer, contract;
// Grab UI elements
const connectBtn = document.getElementById("connectBtn");
const walletAddress = document.getElementById("walletAddress");
// MetaMask Authentication Logic
async function connectWallet() {
    if (typeof window.ethereum !== "undefined") {
        try {
            // Request account access from MetaMask
            await window.ethereum.request({ method: "eth_requestAccounts" });
            // Initialize Ethers provider & signer
            provider = new ethers.BrowserProvider(window.ethereum);
            signer = await provider.getSigner();
            contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
            // Display truncated address on UI
            const address = await signer.getAddress();
            walletAddress.innerText = `Wallet:${address.slice(0, 6)}...${address.slice(-4)}`;
            connectBtn.innerText = "Connected";
            // Automatically fetch items once logged in
            loadProducts();
        } catch (error) {
            console.error("User denied connection request", error);
        }
    } else {
        alert("Please install MetaMask to interact with this application!");
    }
}
connectBtn.addEventListener("click", connectWallet)

const loadProdsBtn = document.getElementById("loadProdsBtn");
const productList = document.getElementById("productList");
// Fetch and Render Products (No Gas Cost)
async function loadProducts() {
    if (!contract) return alert("Please connect your wallet first.");
    try {
        productList.innerHTML = "Fetching shop inventory...";
        // Call the smart contract read-only function
        const products = await contract.getAllProducts();
        productList.innerHTML = "";
        if (products.length === 0) {
            productList.innerHTML = "<p>The shop is currently empty! (Add some items via Remix first).</p>";
            return;
        }
        // Loop through array and build the product cards
        products.forEach(product => {
            const id = product.id.toString();
            const name = product.name;
            const priceEth = ethers.formatEther(product.price); // Convert Wei unit back to ETH string
            const card = document.createElement("div");
            card.className = "product-card";
            card.innerHTML = `
<div>
<strong>#${id} — ${name}</strong>
</div>
<div>
<span>${priceEth} ETH </span>
<button onclick="buyProduct(${id}, '${priceEth}')">Buy Now</button>
</div>
`;
            productList.appendChild(card);
        });
    } catch (error) {
        console.error("Error reading from contract:", error);
        productList.innerHTML = "Failed to load product data.";
    }
}
loadProdsBtn.addEventListener("click", loadProducts);

// Purchase Product (Requires Gas & Native Ether Transfer)
window.buyProduct = async function (id, priceEth) {
    if (!contract) return alert("Please connect your wallet first!");
    try {
        // Convert input ETH back into Wei (e.g. "0.1" -> 100000000000000000n)
        const priceInWei = ethers.parseEther(priceEth);
        // Call the state-changing contract function, passing 'value' to process the payment
        const tx = await contract.buyProduct(id, { value: priceInWei });
        alert("Transaction dispatched to network! Confirming block integration...");
        await tx.wait(); // Pause runtime execution until the transaction is successfully mined
        alert(`Success! You have purchased item #${id}.`);
    } catch (error) {
        console.error("Transaction processing error:", error);
        alert("Transaction failed or rejected. View browser logs for details.");
    }
}

window.ethereum?.on("accountsChanged", (accounts) => {
    provider = new ethers.BrowserProvider(window.ethereum);
    if (accounts.length > 0) {
        signer = provider.getSigner();
        contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
        walletAddress.innerText = `Wallet:${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)}`;
        connectBtn.innerText = "Connected";
    } else {
        walletAddress.innerText = "Wallet: Not Connected";
        connectBtn.innerText = "Connect Wallet";
        contract = null;
    }
});