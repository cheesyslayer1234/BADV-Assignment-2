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

    await contract.connect(organiser).addAuthorisedRegistrant(student.address);
    await contract.connect(organiser).addAuthorisedRegistrant(staff.address);
  });

  describe("Deployment", function () {
    it("sets the organiser to the deployer", async function () {
      expect(await contract.organiser()).to.equal(organiser.address);
    });

    it("stores the carnival end time", async function () {
      expect(await contract.carnivalEndTime()).to.equal(carnivalEndTime);
    });

    it("starts unprocessed and unpaused", async function () {
      expect(await contract.carnivalProcessed()).to.equal(false);
      expect(await contract.paused()).to.equal(false);
    });
  });

  describe("Registrant whitelist", function () {
    it("allows the organiser to authorise a registrant", async function () {
      expect(await contract.isAuthorisedRegistrant(student.address)).to.equal(
        true
      );
    });

    it("rejects non-organiser attempts to authorise", async function () {
      await expect(
        contract.connect(stranger).addAuthorisedRegistrant(buyer1.address)
      ).to.be.revertedWithCustomError(contract, "NotOrganiser");
    });

    it("allows revoking a registrant", async function () {
      await contract.connect(organiser).removeAuthorisedRegistrant(student.address);
      expect(await contract.isAuthorisedRegistrant(student.address)).to.equal(
        false
      );
    });
  });

  describe("Requirement 1: Stall registration (application)", function () {
    it("lets an authorised student submit a stall application", async function () {
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

    it("rejects registration from an unauthorised address", async function () {
      await expect(
        contract.connect(stranger).registerStall("Illegal Stall")
      ).to.be.revertedWithCustomError(contract, "NotAuthorisedToRegister");
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

    it("rejects payments while the contract is paused", async function () {
      await contract.connect(organiser).pause();
      await expect(
        contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(contract, "ContractPaused");
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

  describe("Additional Feature 1: Ratings", function () {
    beforeEach(async function () {
      await contract.connect(student).registerStall("Waffle Wonderland");
      await contract.connect(organiser).approveStall(0);
    });

    it("rejects a rating from someone who never paid", async function () {
      await expect(
        contract.connect(buyer1).rateStall(0, 5)
      ).to.be.revertedWithCustomError(contract, "MustPayBeforeRating");
    });

    it("allows a genuine payer to rate 1-5", async function () {
      await contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") });
      await expect(contract.connect(buyer1).rateStall(0, 4))
        .to.emit(contract, "StallRated")
        .withArgs(0, buyer1.address, 4);

      const [avgTimes100, count] = await contract.getAverageRating(0);
      expect(avgTimes100).to.equal(400);
      expect(count).to.equal(1);
    });

    it("rejects an out-of-range rating", async function () {
      await contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") });
      await expect(
        contract.connect(buyer1).rateStall(0, 6)
      ).to.be.revertedWithCustomError(contract, "InvalidRating");
    });

    it("rejects a second rating from the same payer", async function () {
      await contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") });
      await contract.connect(buyer1).rateStall(0, 3);
      await expect(
        contract.connect(buyer1).rateStall(0, 5)
      ).to.be.revertedWithCustomError(contract, "AlreadyRated");
    });

    it("computes a correct average across multiple raters", async function () {
      await contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") });
      await contract.connect(buyer2).payStall(0, { value: ethers.parseEther("1") });
      await contract.connect(buyer1).rateStall(0, 5);
      await contract.connect(buyer2).rateStall(0, 2);

      const [avgTimes100, count] = await contract.getAverageRating(0);
      expect(avgTimes100).to.equal(350); // (5+2)/2 = 3.5 -> 350
      expect(count).to.equal(2);
    });
  });

  describe("Additional Feature 2: Circuit breaker (pause)", function () {
    beforeEach(async function () {
      await contract.connect(student).registerStall("Waffle Wonderland");
      await contract.connect(organiser).approveStall(0);
    });

    it("only the organiser can pause/unpause", async function () {
      await expect(
        contract.connect(stranger).pause()
      ).to.be.revertedWithCustomError(contract, "NotOrganiser");
    });

    it("blocks refunds and withdrawals while paused", async function () {
      await contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") });
      await contract.connect(organiser).pause();

      await expect(
        contract.connect(student).issueRefund(0, buyer1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(contract, "ContractPaused");

      await time.increaseTo(carnivalEndTime + 1);
      await contract.connect(organiser).processCarnivalEnd();
      await time.increase(24 * 60 * 60 + 1);

      await expect(
        contract.connect(student).withdrawFunds(0)
      ).to.be.revertedWithCustomError(contract, "ContractPaused");
    });

    it("resumes normal operation after unpause", async function () {
      await contract.connect(organiser).pause();
      await contract.connect(organiser).unpause();
      await expect(
        contract.connect(buyer1).payStall(0, { value: ethers.parseEther("1") })
      ).to.emit(contract, "PaymentMade");
    });
  });
});
