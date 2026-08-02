// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CarnivalStallManager {
    error NotOrganiser();
    error NotAuthorisedToRegister();
    error NotStallOwner(uint256 stallId);
    error StallDoesNotExist(uint256 stallId);
    error ContractPaused();
    error ReentrancyDetected();
    error CarnivalNotYetProcessed();
    error WithdrawalWindowNotOpen();
    error NothingToWithdraw();
    error InsufficientStallBalance(uint256 available, uint256 requested);
    error InsufficientPayerCredit(uint256 available, uint256 requested);
    error ZeroAddress();
    error ZeroAmount();
    error EmptyStallName();
    error AlreadyProcessed();
    error TooEarlyToProcess();
    error MustPayBeforeRating();
    error AlreadyRated();
    error InvalidRating();
    error TransferFailed();

    address public organiser;
    mapping(address => bool) private authorisedRegistrants;

    uint256 public immutable carnivalEndTime;

    bool public carnivalProcessed;

    uint256 public carnivalProcessedAt;

    bool public paused;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus = _NOT_ENTERED;

    struct Stall {
        address owner;
        string name;
        uint256 balance;
        bool registered;
        bool withdrawn;
        uint256 totalPaid;
        uint256 ratingSum;
        uint256 ratingCount;
    }

    mapping(uint256 => Stall) public stalls;

    uint256 public stallCount;

    mapping(uint256 => mapping(address => uint256)) private payerCredit;

    mapping(uint256 => mapping(address => bool)) private hasPaidStall;

    mapping(uint256 => mapping(address => bool)) private hasRatedStall;

    event RegistrantAuthorised(address indexed account);
    event RegistrantRevoked(address indexed account);
    event StallRegistered(uint256 indexed stallId, address indexed owner, string name);
    event PaymentMade(uint256 indexed stallId, address indexed payer, uint256 amount);
    event RefundIssued(uint256 indexed stallId, address indexed payer, uint256 amount);
    event CarnivalProcessed(uint256 timestamp);
    event FundsWithdrawn(uint256 indexed stallId, address indexed owner, uint256 amount);
    event StallRated(uint256 indexed stallId, address indexed rater, uint8 rating);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    modifier onlyOrganiser() {
        if (msg.sender != organiser) revert NotOrganiser();
        _;
    }

    modifier onlyAuthorisedRegistrant() {
        if (!authorisedRegistrants[msg.sender]) revert NotAuthorisedToRegister();
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

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
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
        authorisedRegistrants[msg.sender] = true;
        emit RegistrantAuthorised(msg.sender);
    }

    function addAuthorisedRegistrant(address account) external onlyOrganiser {
        if (account == address(0)) revert ZeroAddress();
        authorisedRegistrants[account] = true;
        emit RegistrantAuthorised(account);
    }

    function removeAuthorisedRegistrant(address account) external onlyOrganiser {
        authorisedRegistrants[account] = false;
        emit RegistrantRevoked(account);
    }

    function isAuthorisedRegistrant(address account) external view returns (bool) {
        return authorisedRegistrants[account];
    }

    function registerStall(string calldata name)
        external
        onlyAuthorisedRegistrant
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
            ratingSum: 0,
            ratingCount: 0
        });
        stallCount += 1;

        emit StallRegistered(stallId, msg.sender, name);
    }

    function payStall(uint256 stallId)
        external
        payable
        whenNotPaused
        stallExists(stallId)
    {
        if (msg.value == 0) revert ZeroAmount();

        Stall storage stall = stalls[stallId];
        stall.balance += msg.value;
        stall.totalPaid += msg.value;

        payerCredit[stallId][msg.sender] += msg.value;
        hasPaidStall[stallId][msg.sender] = true;

        emit PaymentMade(stallId, msg.sender, msg.value);
    }

    function issueRefund(uint256 stallId, address payable payer, uint256 amount)
        external
        whenNotPaused
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
        whenNotPaused
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

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit FundsWithdrawn(stallId, msg.sender, amount);
    }

    function rateStall(uint256 stallId, uint8 rating)
        external
        stallExists(stallId)
    {
        if (!hasPaidStall[stallId][msg.sender]) revert MustPayBeforeRating();
        if (hasRatedStall[stallId][msg.sender]) revert AlreadyRated();
        if (rating < 1 || rating > 5) revert InvalidRating();

        hasRatedStall[stallId][msg.sender] = true;

        Stall storage stall = stalls[stallId];
        stall.ratingSum += rating;
        stall.ratingCount += 1;

        emit StallRated(stallId, msg.sender, rating);
    }

    function getAverageRating(uint256 stallId)
        external
        view
        stallExists(stallId)
        returns (uint256 averageTimes100, uint256 ratingCount)
    {
        Stall storage stall = stalls[stallId];
        ratingCount = stall.ratingCount;
        averageTimes100 = ratingCount == 0 ? 0 : (stall.ratingSum * 100) / ratingCount;
    }

    function pause() external onlyOrganiser {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOrganiser {
        paused = false;
        emit Unpaused(msg.sender);
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
            uint256 totalPaid
        )
    {
        Stall storage stall = stalls[stallId];
        return (stall.owner, stall.name, stall.balance, stall.withdrawn, stall.totalPaid);
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
}
