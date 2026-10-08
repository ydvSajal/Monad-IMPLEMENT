// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IGroundedReputation} from "./interfaces/IGroundedReputation.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";
import {IReceiptRouter} from "./interfaces/IReceiptRouter.sol";

/// @title GigEscrow
/// @notice Job escrow with a per-job Grounded trust bar. Payment to the freelancer goes through
///         `ReceiptRouter.payWithAuthorization` so the receipt's payer is the client, who can then rate.
///         Every exit is bounded in time: nobody can lock funds by going silent.
/// @dev No owner, admin, pauser or proxy. Config is immutable. The only privileged role is a per-job
///      arbiter the client names at creation and the freelancer sees before accepting.
contract GigEscrow {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Funded,
        Accepted,
        Delivered,
        Released,
        AutoReleased,
        Refunded,
        Disputed,
        Resolved
    }

    struct Job {
        address client;
        uint96 amount; // paid to freelancer, 6 dp
        uint256 agentId; // 0 until accepted
        address arbiter; // 0 = none: an unresolved dispute splits 50/50 at the deadline
        uint96 offer; // freelancer's settlement ask while Disputed
        uint8 minScore;
        uint32 minReviewers;
        uint40 acceptBy;
        uint40 deliveredAt;
        uint40 deadline; // Accepted: deliver-by. Disputed: resolve-by.
        uint32 deliverWithin; // seconds from accept
        Status status;
        bool offered;
        bytes32 metaHash;
    }

    /// @notice Public track record of a client, so freelancers can judge who they work for.
    struct ClientStats {
        uint32 posted;
        uint32 paid; // released, auto-released or resolved with something paid
        uint32 disputed;
    }

    uint256 public constant MIN_AMOUNT = 10_000; // Grounded router floor, 0.01 USDC

    IERC20 public immutable usdc;
    IReceiptRouter public immutable router;
    IGroundedReputation public immutable grounded;
    IIdentityRegistry public immutable identity;
    address public immutable feeRecipient;
    uint256 public immutable feeBps;
    uint256 public immutable reviewWindow; // also the time a dispute has to resolve

    uint256 public nextJobId = 1;
    mapping(uint256 jobId => Job) internal _jobs;
    mapping(address client => ClientStats) public clientStats;

    event JobCreated(uint256 indexed jobId, address indexed client, uint96 amount, address arbiter, bytes32 metaHash);
    event JobAccepted(uint256 indexed jobId, uint256 indexed agentId, address freelancer, uint40 deliverBy);
    event JobDelivered(uint256 indexed jobId, bytes32 deliveryHash);
    event JobReleased(uint256 indexed jobId, uint256 receiptId);
    event JobAutoReleased(uint256 indexed jobId, address payoutWallet);
    event JobRefunded(uint256 indexed jobId, address by);
    event JobDisputed(uint256 indexed jobId, bytes32 reasonHash, uint40 resolveBy);
    event SettlementOffered(uint256 indexed jobId, uint96 toFreelancer);
    /// @param how 0 = settled by both parties, 1 = arbiter ruling, 2 = timeout split
    event JobResolved(uint256 indexed jobId, uint96 toFreelancer, uint8 how, uint256 receiptId);

    error BadStatus(Status current);
    error NotClient();
    error NotArbiter();
    error NotAgentOperator(uint256 agentId);
    error AgentNotTrusted(uint256 agentId);
    error NoAgentWallet(uint256 agentId);
    error TooEarly();
    error TooLate();
    error AmountBelowMinimum();
    error AmountTooLarge();
    error BadParams();
    error NotRefundable();
    error NoOffer();

    constructor(
        IERC20 usdc_,
        IReceiptRouter router_,
        IGroundedReputation grounded_,
        IIdentityRegistry identity_,
        address feeRecipient_,
        uint256 feeBps_,
        uint256 reviewWindow_
    ) {
        if (feeRecipient_ == address(0) || feeBps_ > 2000) revert BadParams();
        usdc = usdc_;
        router = router_;
        grounded = grounded_;
        identity = identity_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        reviewWindow = reviewWindow_;
    }

    function feeOf(uint256 amount) public view returns (uint256) {
        return amount * feeBps / 10_000;
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    function create(
        uint256 amount,
        uint8 minScore,
        uint32 minReviewers,
        uint40 acceptBy,
        uint32 deliverWithin,
        address arbiter,
        bytes32 metaHash
    ) external returns (uint256 jobId) {
        if (amount < MIN_AMOUNT) revert AmountBelowMinimum();
        if (amount > type(uint96).max) revert AmountTooLarge();
        if (minScore > 100 || acceptBy <= block.timestamp || deliverWithin == 0 || arbiter == msg.sender) {
            revert BadParams();
        }

        jobId = nextJobId++;
        Job storage j = _jobs[jobId];
        j.client = msg.sender;
        // casting is safe: amount <= uint96 max checked above
        // forge-lint: disable-next-line(unsafe-typecast)
        j.amount = uint96(amount);
        j.arbiter = arbiter;
        j.minScore = minScore;
        j.minReviewers = minReviewers;
        j.acceptBy = acceptBy;
        j.deliverWithin = deliverWithin;
        j.status = Status.Funded;
        j.metaHash = metaHash;
        clientStats[msg.sender].posted++;

        // forge-lint: disable-next-line(unsafe-typecast)
        emit JobCreated(jobId, msg.sender, uint96(amount), arbiter, metaHash);
        usdc.safeTransferFrom(msg.sender, address(this), amount + feeOf(amount));
    }

    function accept(uint256 jobId, uint256 agentId) external {
        Job storage j = _jobs[jobId];
        if (j.status != Status.Funded) revert BadStatus(j.status);
        if (block.timestamp > j.acceptBy) revert TooLate();
        _requireOperator(agentId);
        if (identity.getAgentWallet(agentId) == address(0)) revert NoAgentWallet(agentId);
        if ((j.minScore != 0 || j.minReviewers != 0) && !grounded.meets(agentId, j.minScore, j.minReviewers)) {
            revert AgentNotTrusted(agentId);
        }
        j.agentId = agentId;
        j.status = Status.Accepted;
        // forge-lint: disable-next-line(unsafe-typecast)
        j.deadline = uint40(block.timestamp + j.deliverWithin);
        emit JobAccepted(jobId, agentId, msg.sender, j.deadline);
    }

    /// @dev Allowed after the deliver-by deadline as long as the client has not refunded yet.
    function deliver(uint256 jobId, bytes32 deliveryHash) external {
        Job storage j = _jobs[jobId];
        if (j.status != Status.Accepted) revert BadStatus(j.status);
        _requireOperator(j.agentId);
        j.status = Status.Delivered;
        // forge-lint: disable-next-line(unsafe-typecast)
        j.deliveredAt = uint40(block.timestamp);
        emit JobDelivered(jobId, deliveryHash);
    }

    /// @notice Client pays the freelancer. `signature` is the client's EIP-3009 ReceiveWithAuthorization
    ///         (from = client, to = router, value = amount, nonce = router.authorizationNonce(agentId, salt)).
    /// @dev Escrow hands the amount to the client, the router pulls it straight back. Any failure reverts
    ///      the whole call, so the client can never keep the funds.
    function release(uint256 jobId, uint256 validAfter, uint256 validBefore, bytes32 salt, bytes calldata signature)
        external
        returns (uint256 receiptId)
    {
        Job storage j = _jobs[jobId];
        if (msg.sender != j.client) revert NotClient();
        if (j.status != Status.Accepted && j.status != Status.Delivered) revert BadStatus(j.status);
        j.status = Status.Released;
        clientStats[j.client].paid++;
        uint256 amount = j.amount;

        receiptId = _payViaRouter(j, amount, validAfter, validBefore, salt, signature);
        usdc.safeTransfer(feeRecipient, feeOf(amount));
        emit JobReleased(jobId, receiptId);
    }

    /// @notice Client was silent through the review window. Pays the freelancer directly; no receipt, no rating.
    function autoRelease(uint256 jobId) external {
        Job storage j = _jobs[jobId];
        if (j.status != Status.Delivered) revert BadStatus(j.status);
        if (block.timestamp <= uint256(j.deliveredAt) + reviewWindow) revert TooEarly();
        address wallet = identity.getAgentWallet(j.agentId);
        if (wallet == address(0)) revert NoAgentWallet(j.agentId);
        j.status = Status.AutoReleased;
        clientStats[j.client].paid++;
        uint256 amount = j.amount;
        emit JobAutoReleased(jobId, wallet);
        usdc.safeTransfer(wallet, amount);
        usdc.safeTransfer(feeRecipient, feeOf(amount));
    }

    /// @notice Full refund of amount + fee to the client when: nobody accepted by `acceptBy` (client),
    ///         the freelancer withdraws (operator), or the freelancer missed the deliver-by deadline (client).
    function refund(uint256 jobId) external {
        Job storage j = _jobs[jobId];
        if (j.status == Status.Funded) {
            if (msg.sender != j.client) revert NotClient();
            if (block.timestamp <= j.acceptBy) revert TooEarly();
        } else if (j.status == Status.Accepted) {
            bool ghosted = msg.sender == j.client && block.timestamp > j.deadline;
            if (!ghosted && !_isOperator(j.agentId, msg.sender)) revert NotRefundable();
        } else {
            revert BadStatus(j.status);
        }
        j.status = Status.Refunded;
        uint256 total = uint256(j.amount) + feeOf(j.amount);
        emit JobRefunded(jobId, msg.sender);
        usdc.safeTransfer(j.client, total);
    }

    // ---- disputes: settle together, or the arbiter rules, or it splits 50/50 at the deadline

    /// @notice Client contests a delivery inside the review window. Stops auto-release.
    function dispute(uint256 jobId, bytes32 reasonHash) external {
        Job storage j = _jobs[jobId];
        if (msg.sender != j.client) revert NotClient();
        if (j.status != Status.Delivered) revert BadStatus(j.status);
        if (block.timestamp > uint256(j.deliveredAt) + reviewWindow) revert TooLate();
        j.status = Status.Disputed;
        // forge-lint: disable-next-line(unsafe-typecast)
        j.deadline = uint40(block.timestamp + reviewWindow);
        clientStats[j.client].disputed++;
        emit JobDisputed(jobId, reasonHash, j.deadline);
    }

    /// @notice Freelancer names the share they will settle for. Can be revised until the client takes it.
    function offerSettlement(uint256 jobId, uint96 toFreelancer) external {
        Job storage j = _jobs[jobId];
        if (j.status != Status.Disputed) revert BadStatus(j.status);
        _requireOperator(j.agentId);
        if (toFreelancer > j.amount || (toFreelancer != 0 && toFreelancer < MIN_AMOUNT)) revert BadParams();
        j.offer = toFreelancer;
        j.offered = true;
        emit SettlementOffered(jobId, toFreelancer);
    }

    /// @notice Client takes the freelancer's offer. The freelancer's share goes through the router, so the
    ///         client gets a receipt and can still rate. `signature` authorises exactly `toFreelancer`, and
    ///         `toFreelancer` must equal the standing offer (guards against an offer changed in the mempool).
    function settle(
        uint256 jobId,
        uint96 toFreelancer,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        bytes calldata signature
    ) external returns (uint256 receiptId) {
        Job storage j = _jobs[jobId];
        if (msg.sender != j.client) revert NotClient();
        if (j.status != Status.Disputed) revert BadStatus(j.status);
        if (!j.offered || j.offer != toFreelancer) revert NoOffer();
        j.status = Status.Resolved;
        if (toFreelancer != 0) {
            clientStats[j.client].paid++;
            receiptId = _payViaRouter(j, toFreelancer, validAfter, validBefore, salt, signature);
        }
        _closeSplit(j, toFreelancer);
        emit JobResolved(jobId, toFreelancer, 0, receiptId);
    }

    /// @notice The job's arbiter decides the split. Paid directly, no receipt.
    function rule(uint256 jobId, uint96 toFreelancer) external {
        Job storage j = _jobs[jobId];
        if (j.arbiter == address(0) || msg.sender != j.arbiter) revert NotArbiter();
        if (j.status != Status.Disputed) revert BadStatus(j.status);
        if (toFreelancer > j.amount) revert BadParams();
        _resolveDirect(jobId, j, toFreelancer, 1);
    }

    /// @notice Nobody resolved by the deadline: anyone splits it 50/50. Both sides lose something, so both
    ///         have a reason to settle first.
    function resolveTimeout(uint256 jobId) external {
        Job storage j = _jobs[jobId];
        if (j.status != Status.Disputed) revert BadStatus(j.status);
        if (block.timestamp <= j.deadline) revert TooEarly();
        _resolveDirect(jobId, j, j.amount / 2, 2);
    }

    function _resolveDirect(uint256 jobId, Job storage j, uint96 toFreelancer, uint8 how) private {
        j.status = Status.Resolved;
        if (toFreelancer != 0) {
            clientStats[j.client].paid++;
            usdc.safeTransfer(_payee(j.agentId), toFreelancer);
        }
        _closeSplit(j, toFreelancer);
        emit JobResolved(jobId, toFreelancer, how, 0);
    }

    /// @dev Fee is charged only on what the freelancer got; the rest of amount + fee goes back to the client.
    function _closeSplit(Job storage j, uint256 toFreelancer) private {
        uint256 fee = feeOf(toFreelancer);
        uint256 back = uint256(j.amount) - toFreelancer + feeOf(j.amount) - fee;
        if (fee != 0) usdc.safeTransfer(feeRecipient, fee);
        if (back != 0) usdc.safeTransfer(j.client, back);
    }

    function _payViaRouter(
        Job storage j,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        bytes calldata signature
    ) private returns (uint256) {
        usdc.safeTransfer(j.client, value);
        return router.payWithAuthorization(
            j.agentId, address(usdc), j.client, value, validAfter, validBefore, salt, signature
        );
    }

    /// @dev A freelancer must not be able to block a ruling by clearing their payout wallet.
    function _payee(uint256 agentId) private view returns (address w) {
        w = identity.getAgentWallet(agentId);
        if (w == address(0)) w = identity.ownerOf(agentId);
    }

    function _requireOperator(uint256 agentId) private view {
        if (!_isOperator(agentId, msg.sender)) revert NotAgentOperator(agentId);
    }

    function _isOperator(uint256 agentId, address who) private view returns (bool) {
        address owner = identity.ownerOf(agentId);
        return who == owner || who == identity.getApproved(agentId) || identity.isApprovedForAll(owner, who);
    }
}
