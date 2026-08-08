// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CarnivalStallManager {
    error NotOrganiser();
    error NotStallOwner(uint256 stallId);
    error StallDoesNotExist(uint256 stallId);
    error ReentrancyDetected();
    error CarnivalNotYetProcessed();
    error WithdrawalWindowNotOpen();
    error NothingToWithdraw();
    error InsufficientStallBalance(uint256 available, uint256 requested);
    error InsufficientPayerCredit(uint256 available, uint256 requested);
    error ZeroAmount();
    error EmptyStallName();
    error AlreadyProcessed();
    error TooEarlyToProcess();
    error TransferFailed();
    error StallNotPending(uint256 stallId);
    error StallNotApproved(uint256 stallId);
    error StallNotRejected(uint256 stallId);
    error EmptyRejectionReason();
    error CarnivalAlreadyStarted();

    address public organiser;

    uint256 public immutable carnivalEndTime;

    bool public carnivalProcessed;

    uint256 public carnivalProcessedAt;

    // Organiser-flipped switch marking the moment the carnival actually
    // begins. Distinct from carnivalEndTime (used for close-out/withdrawal
    // timing): this only gates whether approved stalls may still cancel.
    bool public carnivalStarted;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus = _NOT_ENTERED;

    enum StallStatus { None, Pending, Approved, Rejected, Cancelled }

    struct Stall {
        address owner;
        string name;
        uint256 balance;
        bool registered;
        bool withdrawn;
        uint256 totalPaid;
        StallStatus status;
        uint256 appliedAt;
        uint256 decidedAt;
        string rejectionReason;
    }

    mapping(uint256 => Stall) public stalls;

    uint256 public stallCount;

    // ---- Carnival-wide transparency accounting ----
    // Running totals kept in storage (rather than summed on-demand across
    // every stall) so anyone — no wallet, no manual per-stall lookups — can
    // read one number for "how much has this carnival raised/refunded/paid
    // out, ever" in a single free eth_call. This is what backs the public
    // transparency dashboard.
    uint256 public totalRaised;    // cumulative sum of every payStall() call, all-time
    uint256 public totalRefunded;  // cumulative sum of every issueRefund() call, all-time
    uint256 public totalWithdrawn; // cumulative sum of every withdrawFunds() call, all-time

    uint256 public pendingCount;
    uint256 public approvedCount;
    uint256 public rejectedCount;
    uint256 public cancelledCount;

    mapping(uint256 => mapping(address => uint256)) private payerCredit;

    event StallApplicationSubmitted(uint256 indexed stallId, address indexed applicant, string name, uint256 timestamp);
    event StallApproved(uint256 indexed stallId, address indexed organiser, uint256 timestamp);
    event StallRejected(uint256 indexed stallId, address indexed organiser, string reason, uint256 timestamp);
    event StallResubmitted(uint256 indexed stallId, address indexed owner, uint256 timestamp);
    event StallCancelled(uint256 indexed stallId, address indexed owner, uint256 timestamp);
    event CarnivalStarted(uint256 timestamp);
    event PaymentMade(uint256 indexed stallId, address indexed payer, uint256 amount);
    event RefundIssued(uint256 indexed stallId, address indexed payer, uint256 amount);
    event CarnivalProcessed(uint256 timestamp);
    event FundsWithdrawn(uint256 indexed stallId, address indexed owner, uint256 amount);

    modifier onlyOrganiser() {
        if (msg.sender != organiser) revert NotOrganiser();
        _;
    }

    modifier onlyStallOwner(uint256 stallId) {
        if (!stalls[stallId].registered) revert StallDoesNotExist(stallId);
        if (stalls[stallId].owner != msg.sender) revert NotStallOwner(stallId);
        _;
    }

    modifier stallExists(uint256 stallId) {
        if (!stalls[stallId].registered) revert StallDoesNotExist(stallId);
        _;
    }

    modifier onlyApprovedStall(uint256 stallId) {
        if (!stalls[stallId].registered) revert StallDoesNotExist(stallId);
        if (stalls[stallId].status != StallStatus.Approved) revert StallNotApproved(stallId);
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyStatus == _ENTERED) revert ReentrancyDetected();
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    constructor(uint256 _carnivalEndTime) {
        organiser = msg.sender;
        carnivalEndTime = _carnivalEndTime;
    }

    /// @notice Registers a stall application. Any address may call this —
    /// there is no on-chain eligibility gate; access control for who is a
    /// genuine TP student/staff member is expected to be handled off-chain
    /// (e.g. only sharing the dApp link/wallet-connect flow with them),
    /// with the organiser as the actual gatekeeper via approveStall/
    /// rejectStall.
    function registerStall(string calldata name)
        external
        returns (uint256 stallId)
    {
        if (bytes(name).length == 0) revert EmptyStallName();

        stallId = stallCount;
        stalls[stallId] = Stall({
            owner: msg.sender,
            name: name,
            balance: 0,
            registered: true,
            withdrawn: false,
            totalPaid: 0,
            status: StallStatus.Pending,
            appliedAt: block.timestamp,
            decidedAt: 0,
            rejectionReason: ""
        });
        stallCount += 1;
        pendingCount += 1;

        emit StallApplicationSubmitted(stallId, msg.sender, name, block.timestamp);
    }

    function approveStall(uint256 stallId) external onlyOrganiser stallExists(stallId) {
        Stall storage stall = stalls[stallId];
        if (stall.status != StallStatus.Pending) revert StallNotPending(stallId);

        stall.status = StallStatus.Approved;
        stall.decidedAt = block.timestamp;
        pendingCount -= 1;
        approvedCount += 1;

        emit StallApproved(stallId, msg.sender, block.timestamp);
    }

    /// @notice Rejects a pending application. A non-empty reason is
    /// mandatory so the applicant knows what to fix before resubmitting.
    function rejectStall(uint256 stallId, string calldata reason)
        external
        onlyOrganiser
        stallExists(stallId)
    {
        Stall storage stall = stalls[stallId];
        if (stall.status != StallStatus.Pending) revert StallNotPending(stallId);
        if (bytes(reason).length == 0) revert EmptyRejectionReason();

        stall.status = StallStatus.Rejected;
        stall.rejectionReason = reason;
        stall.decidedAt = block.timestamp;
        pendingCount -= 1;
        rejectedCount += 1;

        emit StallRejected(stallId, msg.sender, reason, block.timestamp);
    }

    /// @notice Lets a rejected stall's owner update and resubmit their
    /// application. Moves the application back to Pending for another
    /// round of organiser review, and clears the previous rejection reason.
    function resubmitStall(uint256 stallId, string calldata newName)
        external
        onlyStallOwner(stallId)
    {
        Stall storage stall = stalls[stallId];
        if (stall.status != StallStatus.Rejected) revert StallNotRejected(stallId);
        if (bytes(newName).length == 0) revert EmptyStallName();

        stall.name = newName;
        stall.status = StallStatus.Pending;
        stall.appliedAt = block.timestamp;
        stall.decidedAt = 0;
        stall.rejectionReason = "";
        rejectedCount -= 1;
        pendingCount += 1;

        emit StallResubmitted(stallId, msg.sender, block.timestamp);
    }

    /// @notice Lets an approved stall's owner voluntarily cancel before the
    /// carnival starts. Once cancelled the stall drops out of Approved
    /// status, so onlyApprovedStall (and therefore payStall) blocks it
    /// immediately — no separate payment-side check needed.
    function cancelStall(uint256 stallId) external onlyStallOwner(stallId) {
        Stall storage stall = stalls[stallId];
        if (stall.status != StallStatus.Approved) revert StallNotApproved(stallId);
        if (carnivalStarted) revert CarnivalAlreadyStarted();

        stall.status = StallStatus.Cancelled;
        approvedCount -= 1;
        cancelledCount += 1;

        emit StallCancelled(stallId, msg.sender, block.timestamp);
    }

    /// @notice Organiser marks the carnival as having begun, closing the
    /// window in which approved stalls may still cancel.
    function startCarnival() external onlyOrganiser {
        if (carnivalStarted) revert CarnivalAlreadyStarted();
        carnivalStarted = true;
        emit CarnivalStarted(block.timestamp);
    }

    function payStall(uint256 stallId)
        external
        payable
        onlyApprovedStall(stallId)
    {
        if (msg.value == 0) revert ZeroAmount();

        Stall storage stall = stalls[stallId];
        stall.balance += msg.value;
        stall.totalPaid += msg.value;
        totalRaised += msg.value;

        payerCredit[stallId][msg.sender] += msg.value;

        emit PaymentMade(stallId, msg.sender, msg.value);
    }

    function issueRefund(uint256 stallId, address payable payer, uint256 amount)
        external
        nonReentrant
        onlyStallOwner(stallId)
    {
        if (amount == 0) revert ZeroAmount();

        uint256 credit = payerCredit[stallId][payer];
        if (credit < amount) revert InsufficientPayerCredit(credit, amount);

        Stall storage stall = stalls[stallId];
        if (stall.balance < amount) revert InsufficientStallBalance(stall.balance, amount);

        payerCredit[stallId][payer] = credit - amount;
        stall.balance -= amount;
        totalRefunded += amount;

        (bool ok, ) = payer.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit RefundIssued(stallId, payer, amount);
    }

    function processCarnivalEnd() external onlyOrganiser {
        if (carnivalProcessed) revert AlreadyProcessed();
        if (block.timestamp <= carnivalEndTime) revert TooEarlyToProcess();

        carnivalProcessed = true;
        carnivalProcessedAt = block.timestamp;

        emit CarnivalProcessed(block.timestamp);
    }

    function withdrawFunds(uint256 stallId)
        external
        nonReentrant
        onlyStallOwner(stallId)
    {
        if (!carnivalProcessed) revert CarnivalNotYetProcessed();
        if (block.timestamp < carnivalProcessedAt + 1 days) revert WithdrawalWindowNotOpen();

        Stall storage stall = stalls[stallId];
        uint256 amount = stall.balance;
        if (amount == 0) revert NothingToWithdraw();

        stall.balance = 0;
        stall.withdrawn = true;
        totalWithdrawn += amount;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit FundsWithdrawn(stallId, msg.sender, amount);
    }

    function getStall(uint256 stallId)
        external
        view
        stallExists(stallId)
        returns (
            address owner,
            string memory name,
            uint256 balance,
            bool withdrawn,
            uint256 totalPaid,
            StallStatus status,
            uint256 appliedAt,
            uint256 decidedAt,
            string memory rejectionReason
        )
    {
        Stall storage stall = stalls[stallId];
        return (
            stall.owner,
            stall.name,
            stall.balance,
            stall.withdrawn,
            stall.totalPaid,
            stall.status,
            stall.appliedAt,
            stall.decidedAt,
            stall.rejectionReason
        );
    }

    function getPayerCredit(uint256 stallId, address payer) external view returns (uint256) {
        return payerCredit[stallId][payer];
    }

    function isWithdrawalWindowOpen() public view returns (bool) {
        return carnivalProcessed && block.timestamp >= carnivalProcessedAt + 1 days;
    }

    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice One-call summary for the public transparency dashboard —
    /// carnival-wide totals and per-status stall counts, with no need to
    /// loop over individual stalls or hold a wallet/signer. Returned as a
    /// named struct (rather than a bare tuple) so callers get real field
    /// names (stats.pendingCount, etc.) without needing return-parameter
    /// names that would otherwise shadow the state variables of the same
    /// name.
    struct CarnivalStats {
        uint256 stallCount;
        uint256 pendingCount;
        uint256 approvedCount;
        uint256 rejectedCount;
        uint256 cancelledCount;
        uint256 totalRaised;
        uint256 totalRefunded;
        uint256 totalWithdrawn;
        bool carnivalProcessed;
        bool carnivalStarted;
        uint256 carnivalEndTime;
    }

    function getCarnivalStats() external view returns (CarnivalStats memory stats) {
        stats = CarnivalStats({
            stallCount: stallCount,
            pendingCount: pendingCount,
            approvedCount: approvedCount,
            rejectedCount: rejectedCount,
            cancelledCount: cancelledCount,
            totalRaised: totalRaised,
            totalRefunded: totalRefunded,
            totalWithdrawn: totalWithdrawn,
            carnivalProcessed: carnivalProcessed,
            carnivalStarted: carnivalStarted,
            carnivalEndTime: carnivalEndTime
        });
    }

    /// @notice Proves the contract's own bookkeeping (what it *says* it has
    /// raised, refunded and paid out) matches the ETH it actually holds
    /// right now. `expectedBalance` is derived purely from the running
    /// totals above — nobody has to trust the numbers on a dashboard; they
    /// can call this themselves (e.g. on Etherscan's "Read Contract" tab)
    /// and compare against the contract's real balance.
    function auditBalance()
        external
        view
        returns (bool balanced, uint256 expectedBalance, uint256 actualBalance)
    {
        expectedBalance = totalRaised - totalRefunded - totalWithdrawn;
        actualBalance = address(this).balance;
        balanced = expectedBalance == actualBalance;
    }
}
