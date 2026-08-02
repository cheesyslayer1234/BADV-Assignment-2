const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  // Carnival ends at midnight tonight, one day from now, for demo purposes.
  const carnivalEndTime = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  const CarnivalStallManager = await hre.ethers.getContractFactory(
    "CarnivalStallManager"
  );
  const contract = await CarnivalStallManager.deploy(carnivalEndTime);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("CarnivalStallManager deployed to:", address);
  console.log("Carnival end time (unix):", carnivalEndTime);

  // Record deployment details so CI/CD can pick them up (e.g. for a
  // workflow summary or an artifact upload) without scraping console logs.
  const deploymentInfo = {
    network: hre.network.name,
    address,
    carnivalEndTime,
    deployedAt: new Date().toISOString(),
  };
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${hre.network.name}.json`),
    JSON.stringify(deploymentInfo, null, 2)
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
