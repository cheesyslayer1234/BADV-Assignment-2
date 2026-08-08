// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract CarnivalStallManager {
    error NotOrganiser();
    error NotEligibleToRegister();
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

    address public organiser;

    // Merkle-proof path: organiser publishes one root representing the full
    // set of eligible TP students/staff. Anyone in that set can register by
    // submitting a proof, without the contract ever storing the full list.
    bytes32 public eligibleRegistrantsRoot;

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
    }

    mapping(uint256 => Stall) public stalls;

    uint256 public stallCount;

    mapping(uint256 => mapping(address => uint256)) private payerCredit;

    mapping(uint256 => mapping(address => bool)) private hasPaidStall;

    event EligibilityRootUpdated(bytes32 newRoot);
    event StallApplicationSubmitted(uint256 indexed stallId, address indexed applicant, string name, uint256 timestamp);
    event StallApproved(uint256 indexed stallId, address indexed organiser, uint256 timestamp);
    event StallRejected(uint256 indexed stallId, address indexed organiser, uint256 timestamp);
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

    /// @notice Organiser publishes/updates the Merkle root of eligible
    /// TP students/staff addresses. Regenerating and re-publishing the
    /// root is how the eligible list is updated, instead of writing every
    /// address to storage individually.
    function setEligibilityRoot(bytes32 newRoot) external onlyOrganiser {
        eligibleRegistrantsRoot = newRoot;
        emit EligibilityRootUpdated(newRoot);
    }

    /// @notice Checks whether `account` is included in the published
    /// eligibility Merkle tree, given a proof. Leaves are double-hashed
    /// (keccak256(keccak256(abi.encode(account)))) to match the standard
    /// OpenZeppelin/`merkletreejs` convention and avoid second-preimage
    /// attacks against the tree.
    function isEligibleByProof(address account, bytes32[] calldata merkleProof)
        public
        view
        returns (bool)
    {
        if (eligibleRegistrantsRoot == bytes32(0)) return false;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account))));
        return MerkleProof.verify(merkleProof, eligibleRegistrantsRoot, leaf);
    }

    /// @notice Registers a stall application. The caller must supply a
    /// valid Merkle proof that they belong to the published
    /// eligible-registrants set.
    function registerStall(string calldata name, bytes32[] calldata merkleProof)
        external
        returns (uint256 stallId)
    {
        if (!isEligibleByProof(msg.sender, merkleProof)) {
            revert NotEligibleToRegister();
        }
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
            decidedAt: 0
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

    function rejectStall(uint256 stallId) external onlyOrganiser stallExists(stallId) {
        Stall storage stall = stalls[stallId];
        if (stall.status != StallStatus.Pending) revert StallNotPending(stallId);

        stall.status = StallStatus.Rejected;
        stall.decidedAt = block.timestamp;

        emit StallRejected(stallId, msg.sender, block.timestamp);
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
        hasPaidStall[stallId][msg.sender] = true;

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
            uint256 decidedAt
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
            stall.decidedAt
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
}
