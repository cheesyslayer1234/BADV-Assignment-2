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

    carnivalEndTime = (await time.latest()) + 24 * 60 * 60; 

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
      expect(stall.status).to.equal(1); 
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

  describe("Additional Feature 2: One pending application per applicant", function () {
    it("blocks a second application while the first is still pending", async function () {
      await contract.connect(student).registerStall("Stall A");
      await expect(contract.connect(student).registerStall("Stall B"))
        .to.be.revertedWithCustomError(contract, "ApplicantHasPendingApplication")
        .withArgs(student.address, 0);
    });

    it("does not block a different applicant", async function () {
      await contract.connect(student).registerStall("Stall A");
      await expect(contract.connect(staff).registerStall("Stall B")).to.not.be.reverted;
    });

    it("reports pending status via getPendingApplication", async function () {
      await contract.connect(student).registerStall("Stall A");
      const [hasPending, stallId] = await contract.getPendingApplication(student.address);
      expect(hasPending).to.equal(true);
      expect(stallId).to.equal(0);
    });

    it("allows a new application once the pending one is approved", async function () {
      await contract.connect(student).registerStall("Stall A");
      await contract.approveStall(0);
      let [hasPending] = await contract.getPendingApplication(student.address);
      expect(hasPending).to.equal(false);
      await expect(contract.connect(student).registerStall("Stall B")).to.not.be.reverted;
    });

    it("allows a new application once the pending one is rejected", async function () {
      await contract.connect(student).registerStall("Stall A");
      await contract.rejectStall(0, "No permit");
      let [hasPending] = await contract.getPendingApplication(student.address);
      expect(hasPending).to.equal(false);
      await expect(contract.connect(student).registerStall("Stall B")).to.not.be.reverted;
    });

    it("re-flags as pending after a rejected application is resubmitted", async function () {
      await contract.connect(student).registerStall("Stall A");
      await contract.rejectStall(0, "No permit");
      await contract.connect(student).resubmitStall(0, "Stall A v2");
      const [hasPending, stallId] = await contract.getPendingApplication(student.address);
      expect(hasPending).to.equal(true);
      expect(stallId).to.equal(0);
      await expect(contract.connect(student).registerStall("Stall B"))
        .to.be.revertedWithCustomError(contract, "ApplicantHasPendingApplication");
    });
  });

  describe("Requirement 1b: Organiser approval workflow", function () {
    beforeEach(async function () {
      await contract.connect(student).registerStall("Waffle Wonderland");
    });

    it("starts a new application in Pending status", async function () {
      const stall = await contract.getStall(0);
      expect(stall.status).to.equal(1); 
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
      expect(stall.status).to.equal(2); 
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
      expect(stall.status).to.equal(3); 
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

  describe("Additional Feature 1: Resubmission of rejected applications", function () {
    beforeEach(async function () {
      await contract.connect(student).registerStall("Waffle Wonderland");
    });

    it("lets a rejected owner update and resubmit, moving status back to Pending", async function () {
      await contract.connect(organiser).rejectStall(0, "Needs a clearer description");

      await expect(contract.connect(student).resubmitStall(0, "Waffle Wonderland v2"))
        .to.emit(contract, "StallResubmitted")
        .withArgs(0, student.address, anyValue);

      const stall = await contract.getStall(0);
      expect(stall.status).to.equal(1); 
      expect(stall.name).to.equal("Waffle Wonderland v2");
      expect(stall.rejectionReason).to.equal("");
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
      expect(stall.status).to.equal(2); 
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

    it("blocks withdrawal during the processing delay window, even after processing", async function () {
      await time.increaseTo(carnivalEndTime + 1);
      await contract.connect(organiser).processCarnivalEnd();

      // No time advanced yet past processing - PROCESSING_DELAY hasn't elapsed.
      await expect(
        contract.connect(student).withdrawFunds(0)
      ).to.be.revertedWithCustomError(contract, "CarnivalNotYetProcessed");

      expect(await contract.isWithdrawalWindowOpen()).to.equal(false);
    });

    it("allows withdrawal once the processing delay has elapsed", async function () {
      await time.increaseTo(carnivalEndTime + 1);
      await contract.connect(organiser).processCarnivalEnd();

      const delay = await contract.PROCESSING_DELAY();
      await time.increase(delay);

      expect(await contract.isWithdrawalWindowOpen()).to.equal(true);

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

      const delay = await contract.PROCESSING_DELAY();
      await time.increase(delay);

      await expect(
        contract.connect(stranger).withdrawFunds(0)
      ).to.be.revertedWithCustomError(contract, "NotStallOwner");
    });

    it("prevents double withdrawal", async function () {
      await time.increaseTo(carnivalEndTime + 1);
      await contract.connect(organiser).processCarnivalEnd();

      const delay = await contract.PROCESSING_DELAY();
      await time.increase(delay);

      await contract.connect(student).withdrawFunds(0);
      await expect(
        contract.connect(student).withdrawFunds(0)
      ).to.be.revertedWithCustomError(contract, "NothingToWithdraw");
    });
  });

});