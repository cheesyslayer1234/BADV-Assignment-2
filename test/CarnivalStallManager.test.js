const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

// Leaf convention must match the contract:
// keccak256(keccak256(abi.encode(address))), i.e. a double-hashed leaf.
function hashLeaf(address) {
  return Buffer.from(
    ethers.keccak256(
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [address]))
    ).slice(2),
    "hex"
  );
}

function buildTree(addresses) {
  const leaves = addresses.map(hashLeaf);
  return new MerkleTree(leaves, keccak256, { sortPairs: true });
}

const NO_PROOF = [];

describe("CarnivalStallManager", function () {
  let contract, organiser, student, staff, buyer1, buyer2, stranger;
  let carnivalEndTime;
  let eligibleTree, studentProof, staffProof;

  beforeEach(async function () {
    [organiser, student, staff, buyer1, buyer2, stranger] =
      await ethers.getSigners();

    carnivalEndTime = (await time.latest()) + 24 * 60 * 60; // +1 day

    const Factory = await ethers.getContractFactory("CarnivalStallManager");
    contract = await Factory.deploy(carnivalEndTime);
    await contract.waitForDeployment();

    // Eligibility is Merkle-proof only now, so every test that needs an
    // "eligible" registrant publishes a root covering student + staff and
    // uses the matching proof instead of an on-chain whitelist entry.
    eligibleTree = buildTree([student.address, staff.address]);
    await contract.connect(organiser).setEligibilityRoot(eligibleTree.getHexRoot());
    studentProof = eligibleTree.getHexProof(hashLeaf(student.address));
    staffProof = eligibleTree.getHexProof(hashLeaf(staff.address));
  });

  describe("Deployment", function () {
    it("sets the organiser to the deployer", async function () {
      expect(await contract.organiser()).to.equal(organiser.address);
    });

    it("stores the carnival end time", async function () {
      expect(await contract.carnivalEndTime()).to.equal(carnivalEndTime);
    });

    it("starts unprocessed", async function () {
      expect(await contract.carnivalProcessed()).to.equal(false);
    });
  });

  describe("Requirement 1: Stall registration (application)", function () {
    it("lets an eligible student submit a stall application", async function () {
      await expect(contract.connect(student).registerStall("Bubble Tea", studentProof))
        .to.emit(contract, "StallApplicationSubmitted")
        .withArgs(0, student.address, "Bubble Tea", anyValue);

      const stall = await contract.getStall(0);
      expect(stall.owner).to.equal(student.address);
      expect(stall.name).to.equal("Bubble Tea");
      expect(stall.status).to.equal(1); // Pending
      expect(stall.appliedAt).to.be.gt(0);
      expect(stall.decidedAt).to.equal(0);
    });

    it("rejects registration from an ineligible address", async function () {
      await expect(
        contract.connect(stranger).registerStall("Illegal Stall", NO_PROOF)
      ).to.be.revertedWithCustomError(contract, "NotEligibleToRegister");
    });

    it("rejects an empty stall name", async function () {
      await expect(
        contract.connect(student).registerStall("", studentProof)
      ).to.be.revertedWithCustomError(contract, "EmptyStallName");
    });

    it("increments stallCount for each new stall", async function () {
      await contract.connect(student).registerStall("Stall A", studentProof);
      await contract.connect(staff).registerStall("Stall B", staffProof);
      expect(await contract.stallCount()).to.equal(2);
    });
  });

  describe("Requirement 1b: Organiser approval workflow", function () {
    beforeEach(async function () {
      await contract.connect(student).registerStall("Waffle Wonderland", studentProof);
    });

    it("starts a new application in Pending status", async function () {
      const stall = await contract.getStall(0);
      expect(stall.status).to.equal(1); // Pending
    });

    it("blocks payments to a stall that hasn't been approved yet", async function () {
      await expect(
        contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(contract, "StallNotApproved");
    });

    it("lets the organiser approve a pending application", async function () {
      await expect(contract.connect(organiser).approveStall(0))
        .to.emit(contract, "StallApproved")
        .withArgs(0, organiser.address, anyValue);

      const stall = await contract.getStall(0);
      expect(stall.status).to.equal(2); // Approved
      expect(stall.decidedAt).to.be.gt(0);
    });

    it("allows payments once a stall is approved", async function () {
      await contract.connect(organiser).approveStall(0);
      await expect(
        contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") })
      ).to.emit(contract, "PaymentMade");
    });

    it("lets the organiser reject a pending application", async function () {
      await expect(contract.connect(organiser).rejectStall(0))
        .to.emit(contract, "StallRejected")
        .withArgs(0, organiser.address, anyValue);

      const stall = await contract.getStall(0);
      expect(stall.status).to.equal(3); // Rejected
    });

    it("permanently blocks payments to a rejected stall", async function () {
      await contract.connect(organiser).rejectStall(0);
      await expect(
        contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(contract, "StallNotApproved");
    });

    it("rejects approval/rejection from a non-organiser", async function () {
      await expect(
        contract.connect(stranger).approveStall(0)
      ).to.be.revertedWithCustomError(contract, "NotOrganiser");
      await expect(
        contract.connect(stranger).rejectStall(0)
      ).to.be.revertedWithCustomError(contract, "NotOrganiser");
    });

    it("cannot approve a stall that doesn't exist", async function () {
      await expect(
        contract.connect(organiser).approveStall(99)
      ).to.be.revertedWithCustomError(contract, "StallDoesNotExist");
    });

    it("cannot re-approve an already-approved stall", async function () {
      await contract.connect(organiser).approveStall(0);
      await expect(
        contract.connect(organiser).approveStall(0)
      ).to.be.revertedWithCustomError(contract, "StallNotPending");
    });

    it("cannot approve a stall that was already rejected", async function () {
      await contract.connect(organiser).rejectStall(0);
      await expect(
        contract.connect(organiser).approveStall(0)
      ).to.be.revertedWithCustomError(contract, "StallNotPending");
    });
  });

  describe("Requirement 2: Public payments", function () {
    beforeEach(async function () {
      await contract.connect(student).registerStall("Waffle Wonderland", studentProof);
      await contract.connect(organiser).approveStall(0);
    });

    it("accepts a payment and credits the stall balance", async function () {
      await expect(
        contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") })
      )
        .to.emit(contract, "PaymentMade")
        .withArgs(0, buyer1.address, ethers.parseEther("1"));

      const stall = await contract.getStall(0);
      expect(stall.balance).to.equal(ethers.parseEther("1"));
    });

    it("rejects a zero-value payment", async function () {
      await expect(
        contract.connect(buyer1).payStall(0, { value: 0 })
      ).to.be.revertedWithCustomError(contract, "ZeroAmount");
    });

    it("rejects payment to a non-existent stall", async function () {
      await expect(
        contract.connect(buyer1).payStall(99, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(contract, "StallDoesNotExist");
    });
  });

  describe("Requirement 3: Stall-owner refunds", function () {
    beforeEach(async function () {
      await contract.connect(student).registerStall("Waffle Wonderland", studentProof);
      await contract.connect(organiser).approveStall(0);
      await contract.connect(buyer1).payStall(0, { value: ethers.parseEther("2") });
    });

    it("lets the stall owner refund a payer up to what they paid", async function () {
      const before = await ethers.provider.getBalance(buyer1.address);

      const tx = await contract
        .connect(student)
        .issueRefund(0, buyer1.address, ethers.parseEther("1"));
      await expect(tx)
        .to.emit(contract, "RefundIssued")
        .withArgs(0, buyer1.address, ethers.parseEther("1"));

      const after = await ethers.provider.getBalance(buyer1.address);
      expect(after - before).to.equal(ethers.parseEther("1"));

      const stall = await contract.getStall(0);
      expect(stall.balance).to.equal(ethers.parseEther("1"));
    });

    it("rejects a refund attempt by a non-owner", async function () {
      await expect(
        contract
          .connect(stranger)
          .issueRefund(0, buyer1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(contract, "NotStallOwner");
    });

    it("rejects refunding more than a specific payer's credit", async function () {
      await expect(
        contract
          .connect(student)
          .issueRefund(0, buyer1.address, ethers.parseEther("5"))
      ).to.be.revertedWithCustomError(contract, "InsufficientPayerCredit");
    });

    it("cannot refund one payer using another payer's contribution", async function () {
      // buyer2 never paid, so their credit is zero even though the stall
      // balance (from buyer1) is nonzero.
      await expect(
        contract
          .connect(student)
          .issueRefund(0, buyer2.address, ethers.parseEther("0.5"))
      ).to.be.revertedWithCustomError(contract, "InsufficientPayerCredit");
    });
  });

  describe("Requirement 4: Post-carnival withdrawal", function () {
    beforeEach(async function () {
      await contract.connect(student).registerStall("Waffle Wonderland", studentProof);
      await contract.connect(organiser).approveStall(0);
      await contract.connect(buyer1).payStall(0, { value: ethers.parseEther("3") });
    });

    it("blocks processing before the carnival end time", async function () {
      await expect(
        contract.connect(organiser).processCarnivalEnd()
      ).to.be.revertedWithCustomError(contract, "TooEarlyToProcess");
    });

    it("blocks withdrawal before processing has occurred", async function () {
      await time.increaseTo(carnivalEndTime + 1);
      await expect(
        contract.connect(student).withdrawFunds(0)
      ).to.be.revertedWithCustomError(contract, "CarnivalNotYetProcessed");
    });

    it("blocks withdrawal on the same day processing occurred", async function () {
      await time.increaseTo(carnivalEndTime + 1);
      await contract.connect(organiser).processCarnivalEnd();

      await expect(
        contract.connect(student).withdrawFunds(0)
      ).to.be.revertedWithCustomError(contract, "WithdrawalWindowNotOpen");
    });

    it("allows withdrawal the day after processing", async function () {
      await time.increaseTo(carnivalEndTime + 1);
      await contract.connect(organiser).processCarnivalEnd();
      await time.increase(24 * 60 * 60 + 1);

      const before = await ethers.provider.getBalance(student.address);
      const tx = await contract.connect(student).withdrawFunds(0);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(student.address);

      expect(after - before + gasCost).to.equal(ethers.parseEther("3"));

      const stall = await contract.getStall(0);
      expect(stall.balance).to.equal(0);
      expect(stall.withdrawn).to.equal(true);
    });

    it("prevents a non-owner from withdrawing", async function () {
      await time.increaseTo(carnivalEndTime + 1);
      await contract.connect(organiser).processCarnivalEnd();
      await time.increase(24 * 60 * 60 + 1);

      await expect(
        contract.connect(stranger).withdrawFunds(0)
      ).to.be.revertedWithCustomError(contract, "NotStallOwner");
    });

    it("prevents double withdrawal", async function () {
      await time.increaseTo(carnivalEndTime + 1);
      await contract.connect(organiser).processCarnivalEnd();
      await time.increase(24 * 60 * 60 + 1);

      await contract.connect(student).withdrawFunds(0);
      await expect(
        contract.connect(student).withdrawFunds(0)
      ).to.be.revertedWithCustomError(contract, "NothingToWithdraw");
    });
  });

  describe("Additional Feature: Merkle-proof eligibility", function () {
    it("starts with an empty root, so proofs are rejected by default", async function () {
      // Fresh, unconfigured deployment — the shared beforeEach above
      // already publishes a root on `contract` for the other tests here.
      const Factory = await ethers.getContractFactory("CarnivalStallManager");
      const fresh = await Factory.deploy(carnivalEndTime);
      await fresh.waitForDeployment();

      expect(await fresh.eligibleRegistrantsRoot()).to.equal(ethers.ZeroHash);
      expect(await fresh.isEligibleByProof(buyer1.address, [])).to.equal(false);
    });

    it("only the organiser can publish the eligibility root", async function () {
      const tree = buildTree([buyer1.address]);
      await expect(
        contract.connect(stranger).setEligibilityRoot(tree.getHexRoot())
      ).to.be.revertedWithCustomError(contract, "NotOrganiser");
    });

    it("emits EligibilityRootUpdated when the organiser publishes a root", async function () {
      const tree = buildTree([buyer1.address, buyer2.address]);
      await expect(contract.connect(organiser).setEligibilityRoot(tree.getHexRoot()))
        .to.emit(contract, "EligibilityRootUpdated")
        .withArgs(tree.getHexRoot());
    });

    it("lets any address in the published tree prove membership and register", async function () {
      const eligible = [buyer1.address, buyer2.address, staff.address];
      const tree = buildTree(eligible);
      await contract.connect(organiser).setEligibilityRoot(tree.getHexRoot());

      const proof = tree.getHexProof(hashLeaf(buyer1.address));
      expect(await contract.isEligibleByProof(buyer1.address, proof)).to.equal(true);

      await expect(contract.connect(buyer1).registerStall("Proof Popcorn", proof))
        .to.emit(contract, "StallApplicationSubmitted")
        .withArgs(0, buyer1.address, "Proof Popcorn", anyValue);

      const stall = await contract.getStall(0);
      expect(stall.owner).to.equal(buyer1.address);
    });

    it("rejects a proof for an address that isn't in the published tree", async function () {
      const tree = buildTree([buyer1.address, buyer2.address]);
      await contract.connect(organiser).setEligibilityRoot(tree.getHexRoot());

      // stranger tries to reuse buyer1's proof for their own address.
      const wrongProof = tree.getHexProof(hashLeaf(buyer1.address));
      expect(await contract.isEligibleByProof(stranger.address, wrongProof)).to.equal(false);

      await expect(
        contract.connect(stranger).registerStall("Fake Stall", wrongProof)
      ).to.be.revertedWithCustomError(contract, "NotEligibleToRegister");
    });

    it("rejects registration with an empty proof against a published root", async function () {
      const tree = buildTree([buyer1.address]);
      await contract.connect(organiser).setEligibilityRoot(tree.getHexRoot());

      await expect(
        contract.connect(stranger).registerStall("No Proof Stall", NO_PROOF)
      ).to.be.revertedWithCustomError(contract, "NotEligibleToRegister");
    });

    it("rejects re-publishing so an old root/proof no longer verifies", async function () {
      const firstTree = buildTree([buyer1.address]);
      await contract.connect(organiser).setEligibilityRoot(firstTree.getHexRoot());
      const staleProof = firstTree.getHexProof(hashLeaf(buyer1.address));

      // organiser rotates the eligible list, buyer1 is dropped.
      const secondTree = buildTree([buyer2.address]);
      await contract.connect(organiser).setEligibilityRoot(secondTree.getHexRoot());

      expect(await contract.isEligibleByProof(buyer1.address, staleProof)).to.equal(false);
      await expect(
        contract.connect(buyer1).registerStall("Late Stall", staleProof)
      ).to.be.revertedWithCustomError(contract, "NotEligibleToRegister");
    });
  });
});
