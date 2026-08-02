const hre = require("hardhat");

async function main() {
  // Carnival ends at midnight tonight, one day from now, for demo purposes.
  const carnivalEndTime = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  const CarnivalStallManager = await hre.ethers.getContractFactory(
    "CarnivalStallManager"
  );
  const contract = await CarnivalStallManager.deploy(carnivalEndTime);
  await contract.waitForDeployment();

  console.log("CarnivalStallManager deployed to:", await contract.getAddress());
  console.log("Carnival end time (unix):", carnivalEndTime);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
