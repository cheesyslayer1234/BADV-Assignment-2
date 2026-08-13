// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CarnivalStallManager {
    error NotOrganiser();
    error NotStallOwner(uint256 stallId);
    error StallDoesNotExist(uint256 stallId);
    error ReentrancyDetected();
    error CarnivalNotYetProcessed();
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
    error ApplicantHasPendingApplication(address applicant, uint256 pendingStallId);

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

    
    
    
    
    
    
    mapping(address => bool) public hasPendingApplication;
    mapping(address => uint256) public pendingStallIdOf;

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

    
    
    
    function _clearPendingFlag(address owner, uint256 stallId) internal {
        if (hasPendingApplication[owner] && pendingStallIdOf[owner] == stallId) {
            hasPendingApplication[owner] = false;
        }
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

    function registerStall(string calldata name)
        external
        returns (uint256 stallId)
    {
        if (bytes(name).length == 0) revert EmptyStallName();
        if (hasPendingApplication[msg.sender]) {
            revert ApplicantHasPendingApplication(msg.sender, pendingStallIdOf[msg.sender]);
        }

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

        hasPendingApplication[msg.sender] = true;
        pendingStallIdOf[msg.sender] = stallId;

        emit StallApplicationSubmitted(stallId, msg.sender, name, block.timestamp);
    }

    function approveStall(uint256 stallId) external onlyOrganiser stallExists(stallId) {
        Stall storage stall = stalls[stallId];
        if (stall.status != StallStatus.Pending) revert StallNotPending(stallId);

        stall.status = StallStatus.Approved;
        stall.decidedAt = block.timestamp;

        _clearPendingFlag(stall.owner, stallId);

        emit StallApproved(stallId, msg.sender, block.timestamp);
    }

    
    
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

        _clearPendingFlag(stall.owner, stallId);

        emit StallRejected(stallId, msg.sender, reason, block.timestamp);
    }

    
    
    
    function resubmitStall(uint256 stallId, string calldata newName)
        external
        onlyStallOwner(stallId)
    {
        Stall storage stall = stalls[stallId];
        if (stall.status != StallStatus.Rejected) revert StallNotRejected(stallId);
        if (bytes(newName).length == 0) revert EmptyStallName();
        
        
        
        
        
        
        if (hasPendingApplication[msg.sender] && pendingStallIdOf[msg.sender] != stallId) {
            revert ApplicantHasPendingApplication(msg.sender, pendingStallIdOf[msg.sender]);
        }

        stall.name = newName;
        stall.status = StallStatus.Pending;
        stall.appliedAt = block.timestamp;
        stall.decidedAt = 0;
        stall.rejectionReason = "";

        hasPendingApplication[msg.sender] = true;
        pendingStallIdOf[msg.sender] = stallId;

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

        Stall storage stall = stalls[stallId];

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

    
    
    
    
    function getPendingApplication(address applicant)
        external
        view
        returns (bool hasPending, uint256 stallId)
    {
        return (hasPendingApplication[applicant], pendingStallIdOf[applicant]);
    }

    
    
    
    function isWithdrawalWindowOpen() public view returns (bool) {
        return carnivalProcessed;
    }

    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
//