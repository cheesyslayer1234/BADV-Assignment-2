const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("CarnivalStallManager", function () {
  let contract, organiser, student, staff, buyer1, buyer2, stranger;
  let carnivalEndTime;

  beforeEach(async function () {
    [organiser, student, staff, buyer1, buyer2, stranger] =
      await ethers.getSigners();

    carnivalEndTime = (await time.latest()) + 24 * 60 * 60; // +1 day

    const Factory = await ethers.getContractFactory("CarnivalStallManager");
    contract = await Factory.deploy(carnivalEndTime);
    await contract.waitForDeployment();
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
    it("lets a student submit a stall application", async function () {
      await expect(contract.connect(student).registerStall("Bubble Tea"))
        .to.emit(contract, "StallApplicationSubmitted")
        .withArgs(0, student.address, "Bubble Tea", anyValue);

      const stall = await contract.getStall(0);
      expect(stall.owner).to.equal(student.address);
      expect(stall.name).to.equal("Bubble Tea");
      expect(stall.status).to.equal(1); // Pending
      expect(stall.appliedAt).to.be.gt(0);
      expect(stall.decidedAt).to.equal(0);
    });

    it("lets any connected wallet submit a stall application (no eligibility gate)", async function () {
      await expect(contract.connect(stranger).registerStall("Anyone's Stall"))
        .to.emit(contract, "StallApplicationSubmitted")
        .withArgs(0, stranger.address, "Anyone's Stall", anyValue);
    });

    it("rejects an empty stall name", async function () {
      await expect(
        contract.connect(student).registerStall("")
      ).to.be.revertedWithCustomError(contract, "EmptyStallName");
    });

    it("increments stallCount for each new stall", async function () {
      await contract.connect(student).registerStall("Stall A");
      await contract.connect(staff).registerStall("Stall B");
      expect(await contract.stallCount()).to.equal(2);
    });
  });

  describe("Requirement 1b: Organiser approval workflow", function () {
    beforeEach(async function () {
      await contract.connect(student).registerStall("Waffle Wonderland");
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

    it("lets the organiser reject a pending application with a reason", async function () {
      await expect(contract.connect(organiser).rejectStall(0, "Missing food safety cert"))
        .to.emit(contract, "StallRejected")
        .withArgs(0, organiser.address, "Missing food safety cert", anyValue);

      const stall = await contract.getStall(0);
      expect(stall.status).to.equal(3); // Rejected
      expect(stall.rejectionReason).to.equal("Missing food safety cert");
    });

    it("requires a non-empty rejection reason", async function () {
      await expect(
        contract.connect(organiser).rejectStall(0, "")
      ).to.be.revertedWithCustomError(contract, "EmptyRejectionReason");
    });

    it("permanently blocks payments to a rejected stall", async function () {
      await contract.connect(organiser).rejectStall(0, "Not enough info");
      await expect(
        contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(contract, "StallNotApproved");
    });

    it("rejects approval/rejection from a non-organiser", async function () {
      await expect(
        contract.connect(stranger).approveStall(0)
      ).to.be.revertedWithCustomError(contract, "NotOrganiser");
      await expect(
        contract.connect(stranger).rejectStall(0, "nope")
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
      await contract.connect(organiser).rejectStall(0, "Duplicate stall category");
      await expect(
        contract.connect(organiser).approveStall(0)
      ).to.be.revertedWithCustomError(contract, "StallNotPending");
    });
  });

  describe("Additional Feature 1: Resubmission, cancellation & carnival-start gate", function () {
    beforeEach(async function () {
      await contract.connect(student).registerStall("Waffle Wonderland");
    });

    it("lets a rejected owner update and resubmit, moving status back to Pending", async function () {
      await contract.connect(organiser).rejectStall(0, "Needs a clearer description");

      await expect(contract.connect(student).resubmitStall(0, "Waffle Wonderland v2"))
        .to.emit(contract, "StallResubmitted")
        .withArgs(0, student.address, anyValue);

      const stall = await contract.getStall(0);
      expect(stall.status).to.equal(1); // Pending
      expect(stall.name).to.equal("Waffle Wonderland v2");
      expect(stall.rejectionReason).to.equal("");

      const stats = await contract.getCarnivalStats();
      expect(stats.pendingCount).to.equal(1);
      expect(stats.rejectedCount).to.equal(0);
    });

    it("blocks resubmission of a stall that isn't rejected", async function () {
      await expect(
        contract.connect(student).resubmitStall(0, "New name")
      ).to.be.revertedWithCustomError(contract, "StallNotRejected");
    });

    it("blocks resubmission by anyone other than the stall owner", async function () {
      await contract.connect(organiser).rejectStall(0, "Needs work");
      await expect(
        contract.connect(stranger).resubmitStall(0, "Hijack attempt")
      ).to.be.revertedWithCustomError(contract, "NotStallOwner");
    });

    it("lets the organiser re-review a resubmitted application", async function () {
      await contract.connect(organiser).rejectStall(0, "Needs work");
      await contract.connect(student).resubmitStall(0, "Waffle Wonderland v2");

      await expect(contract.connect(organiser).approveStall(0))
        .to.emit(contract, "StallApproved");
      const stall = await contract.getStall(0);
      expect(stall.status).to.equal(2); // Approved
    });

    it("lets an approved owner cancel before the carnival starts", async function () {
      await contract.connect(organiser).approveStall(0);

      await expect(contract.connect(student).cancelStall(0))
        .to.emit(contract, "StallCancelled")
        .withArgs(0, student.address, anyValue);

      const stall = await contract.getStall(0);
      expect(stall.status).to.equal(4); // Cancelled

      const stats = await contract.getCarnivalStats();
      expect(stats.approvedCount).to.equal(0);
      expect(stats.cancelledCount).to.equal(1);
    });

    it("blocks payments to a cancelled stall", async function () {
      await contract.connect(organiser).approveStall(0);
      await contract.connect(student).cancelStall(0);

      await expect(
        contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(contract, "StallNotApproved");
    });

    it("only allows the stall owner to cancel", async function () {
      await contract.connect(organiser).approveStall(0);
      await expect(
        contract.connect(stranger).cancelStall(0)
      ).to.be.revertedWithCustomError(contract, "NotStallOwner");
    });

    it("can only cancel a stall that is currently Approved", async function () {
      await expect(
        contract.connect(student).cancelStall(0) // still Pending
      ).to.be.revertedWithCustomError(contract, "StallNotApproved");
    });

    it("blocks cancellation once the organiser has started the carnival", async function () {
      await contract.connect(organiser).approveStall(0);
      await contract.connect(organiser).startCarnival();

      await expect(
        contract.connect(student).cancelStall(0)
      ).to.be.revertedWithCustomError(contract, "CarnivalAlreadyStarted");
    });

    it("only the organiser can start the carnival, and only once", async function () {
      await expect(
        contract.connect(stranger).startCarnival()
      ).to.be.revertedWithCustomError(contract, "NotOrganiser");

      await expect(contract.connect(organiser).startCarnival())
        .to.emit(contract, "CarnivalStarted");

      await expect(
        contract.connect(organiser).startCarnival()
      ).to.be.revertedWithCustomError(contract, "CarnivalAlreadyStarted");
    });
  });

  describe("Requirement 2: Public payments", function () {
    beforeEach(async function () {
      await contract.connect(student).registerStall("Waffle Wonderland");
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
      await contract.connect(student).registerStall("Waffle Wonderland");
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
      await contract.connect(student).registerStall("Waffle Wonderland");
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

  describe("Additional Feature: Transparency accounting", function () {
    beforeEach(async function () {
      await contract.connect(student).registerStall("Waffle Wonderland");
      await contract.connect(staff).registerStall("Iced Tea Stand");
    });

    it("tracks pending/approved/rejected counts as applications move through review", async function () {
      let stats = await contract.getCarnivalStats();
      expect(stats.pendingCount).to.equal(2);
      expect(stats.approvedCount).to.equal(0);
      expect(stats.rejectedCount).to.equal(0);

      await contract.connect(organiser).approveStall(0);
      await contract.connect(organiser).rejectStall(1, "Duplicate category");

      stats = await contract.getCarnivalStats();
      expect(stats.pendingCount).to.equal(0);
      expect(stats.approvedCount).to.equal(1);
      expect(stats.rejectedCount).to.equal(1);
      expect(stats.stallCount).to.equal(2);
    });

    it("accumulates totalRaised across payments to multiple stalls", async function () {
      await contract.connect(organiser).approveStall(0);
      await contract.connect(organiser).approveStall(1);

      await contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") });
      await contract.connect(buyer2).payStall(1, { value: ethers.parseEther("2") });

      const stats = await contract.getCarnivalStats();
      expect(stats.totalRaised).to.equal(ethers.parseEther("3"));
      expect(stats.totalRefunded).to.equal(0);
      expect(stats.totalWithdrawn).to.equal(0);
    });

    it("accumulates totalRefunded independently of totalRaised", async function () {
      await contract.connect(organiser).approveStall(0);
      await contract.connect(buyer1).payStall(0, { value: ethers.parseEther("2") });
      await contract.connect(student).issueRefund(0, buyer1.address, ethers.parseEther("0.5"));

      const stats = await contract.getCarnivalStats();
      expect(stats.totalRaised).to.equal(ethers.parseEther("2"));
      expect(stats.totalRefunded).to.equal(ethers.parseEther("0.5"));
    });

    it("accumulates totalWithdrawn after payout", async function () {
      await contract.connect(organiser).approveStall(0);
      await contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") });

      await time.increaseTo(carnivalEndTime + 1);
      await contract.connect(organiser).processCarnivalEnd();
      await time.increase(24 * 60 * 60 + 1);
      await contract.connect(student).withdrawFunds(0);

      const stats = await contract.getCarnivalStats();
      expect(stats.totalWithdrawn).to.equal(ethers.parseEther("1"));
    });

    it("auditBalance() reports balanced=true when bookkeeping matches the real balance", async function () {
      await contract.connect(organiser).approveStall(0);
      await contract.connect(buyer1).payStall(0, { value: ethers.parseEther("2") });
      await contract.connect(student).issueRefund(0, buyer1.address, ethers.parseEther("0.5"));

      const audit = await contract.auditBalance();
      const actualBalance = await ethers.provider.getBalance(await contract.getAddress());

      expect(audit.balanced).to.equal(true);
      expect(audit.expectedBalance).to.equal(ethers.parseEther("1.5"));
      expect(audit.actualBalance).to.equal(actualBalance);
    });

    it("auditBalance() stays balanced through the full raise -> refund -> withdraw lifecycle", async function () {
      await contract.connect(organiser).approveStall(0);
      await contract.connect(buyer1).payStall(0, { value: ethers.parseEther("3") });
      await contract.connect(student).issueRefund(0, buyer1.address, ethers.parseEther("1"));

      await time.increaseTo(carnivalEndTime + 1);
      await contract.connect(organiser).processCarnivalEnd();
      await time.increase(24 * 60 * 60 + 1);
      await contract.connect(student).withdrawFunds(0);

      const audit = await contract.auditBalance();
      expect(audit.balanced).to.equal(true);
      expect(audit.expectedBalance).to.equal(0);
      expect(audit.actualBalance).to.equal(0);
    });
  });
});
