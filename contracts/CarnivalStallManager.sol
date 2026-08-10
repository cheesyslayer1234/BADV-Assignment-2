// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CarnivalStallManager {
    error NotOrganiser();
    error NotStallOwner(uint256 stallId);
    error StallDoesNotExist(uint256 stallId);
    error ReentrancyDetected();
    error CarnivalNotYetProcessed();
    error NothingToWithdraw();
    error AlreadyWithdrawn(uint256 stallId);
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

    address public organiser;

    uint256 public immutable carnivalEndTime;

    bool public carnivalProcessed;

    uint256 public carnivalProcessedAt;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus = _NOT_ENTERED;

    enum StallStatus { None, Pending, Approved, Rejected }

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

    mapping(uint256 => mapping(address => uint256)) private payerCredit;

    event StallApplicationSubmitted(uint256 indexed stallId, address indexed applicant, string name, uint256 timestamp);
    event StallApproved(uint256 indexed stallId, address indexed organiser, uint256 timestamp);
    event StallRejected(uint256 indexed stallId, address indexed organiser, string reason, uint256 timestamp);
    event StallResubmitted(uint256 indexed stallId, address indexed owner, uint256 timestamp);
    event PaymentMade(uint256 indexed stallId, address indexed payer, uint256 amount);
    event RefundIssued(uint256 indexed stallId, address indexed payer, uint256 amount);
    event CarnivalProcessed(uint256 timestamp);
    event FundsWithdrawn(uint256 indexed stallId, address indexed owner, uint256 amount);

    modifier onlyOrganiser() {
        if (msg.sender != organiser) revert NotOrganiser();
        _;
    }

    // FIX 3: single source of truth for the "does this stall exist" check.
    // stallExists / onlyStallOwner / onlyApprovedStall all funnel through
    // this internal helper instead of each repeating the same require line.
    // Keeps the check consistent if it ever needs to change, and keeps each
    // modifier focused on the *one* extra condition it's adding.
    function _requireRegistered(uint256 stallId) internal view {
        if (!stalls[stallId].registered) revert StallDoesNotExist(stallId);
    }

    modifier stallExists(uint256 stallId) {
        _requireRegistered(stallId);
        _;
    }

    modifier onlyStallOwner(uint256 stallId) {
        _requireRegistered(stallId);
        if (stalls[stallId].owner != msg.sender) revert NotStallOwner(stallId);
        _;
    }

    modifier onlyApprovedStall(uint256 stallId) {
        _requireRegistered(stallId);
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

        emit StallApplicationSubmitted(stallId, msg.sender, name, block.timestamp);
    }

    function approveStall(uint256 stallId) external onlyOrganiser stallExists(stallId) {
        Stall storage stall = stalls[stallId];
        if (stall.status != StallStatus.Pending) revert StallNotPending(stallId);

        stall.status = StallStatus.Approved;
        stall.decidedAt = block.timestamp;

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

        emit StallResubmitted(stallId, msg.sender, block.timestamp);
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

        (bool ok, ) = payer.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit RefundIssued(stallId, payer, amount);
    }

    /// @notice Marks the carnival as processed. Per the brief, withdrawal
    /// opens once the organiser has processed the carnival day (which can
    /// only happen after carnivalEndTime has passed — i.e. "the following
    /// day"). No further artificial delay is layered on top of this: the
    /// single carnivalEndTime + processed gate IS "the following day"
    /// requirement, so withdrawFunds no longer adds an extra +1 days wait
    /// on top (FIX 1 — see withdrawFunds below).
    function processCarnivalEnd() external onlyOrganiser {
        if (carnivalProcessed) revert AlreadyProcessed();
        if (block.timestamp <= carnivalEndTime) revert TooEarlyToProcess();

        carnivalProcessed = true;
        carnivalProcessedAt = block.timestamp;

        emit CarnivalProcessed(block.timestamp);
    }

    /// @notice Withdraws a stall's full collected balance to its owner.
    /// FIX 1: withdrawal now opens as soon as the organiser has processed
    /// the carnival end (carnivalProcessed == true), instead of requiring
    /// an additional fixed 1-day wait after processing on top of that. The
    /// old logic effectively made owners wait ~2 days after carnivalEndTime
    /// (1 day for the organiser to process + a further 1-day withdrawal
    /// delay), which was stricter than "withdraw the day after it is
    /// processed by the organisers." processCarnivalEnd() already cannot be
    /// called until after carnivalEndTime, so that single check is enough.
    /// FIX 2: `withdrawn` is now an active guard, not just a display flag —
    /// it's checked explicitly (in addition to balance == 0) as a
    /// deliberate defense-in-depth measure, so a stall can never be paid
    /// out twice even under a hypothetical bug in the balance accounting.
    function withdrawFunds(uint256 stallId)
        external
        nonReentrant
        onlyStallOwner(stallId)
    {
        if (!carnivalProcessed) revert CarnivalNotYetProcessed();

        Stall storage stall = stalls[stallId];
        if (stall.withdrawn) revert AlreadyWithdrawn(stallId);

        uint256 amount = stall.balance;
        if (amount == 0) revert NothingToWithdraw();

        stall.balance = 0;
        stall.withdrawn = true;

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

    /// @notice FIX 1: withdrawal window is now simply "has the organiser
    /// processed the carnival end", with no extra fixed delay stacked on.
    function isWithdrawalWindowOpen() public view returns (bool) {
        return carnivalProcessed;
    }

    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
