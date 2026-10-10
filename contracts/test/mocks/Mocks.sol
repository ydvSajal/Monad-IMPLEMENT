// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IGroundedReputation} from "../../src/interfaces/IGroundedReputation.sol";
import {IIdentityRegistry} from "../../src/interfaces/IIdentityRegistry.sol";
import {IReceiptRegistry} from "../../src/interfaces/IReceiptRegistry.sol";
import {IReceiptRouter} from "../../src/interfaces/IReceiptRouter.sol";

/// @dev 6 dp token with an EIP-3009 stand-in. Signature bytes are ignored except that `v` must be 1
///      (so tests can make a "bad signature" revert).
contract MockUSDC is ERC20 {
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    error CallerNotPayee();
    error AuthorizationUsed();
    error AuthorizationExpired();
    error InvalidSignature();

    constructor() ERC20("USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Stand-in for Circle's blacklist: transfers to or from a blocked address revert.
    mapping(address => bool) public blocked;
    error Blocked(address who);

    function setBlocked(address who, bool b) external {
        blocked[who] = b;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocked[from]) revert Blocked(from);
        if (blocked[to]) revert Blocked(to);
        super._update(from, to, value);
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32,
        bytes32
    ) external {
        if (msg.sender != to) revert CallerNotPayee();
        if (v != 1) revert InvalidSignature();
        if (authorizationState[from][nonce]) revert AuthorizationUsed();
        if (block.timestamp <= validAfter || block.timestamp >= validBefore) revert AuthorizationExpired();
        authorizationState[from][nonce] = true;
        _transfer(from, to, value);
    }
}

interface IMockUSDC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @dev Mirrors ReceiptRouter.payWithAuthorization: pull from `from`, forward to agent wallet, payer = from.
///      Also stands in for the ReceiptRegistry (`receipts()` returns itself).
contract MockRouter is IReceiptRouter {
    MockUSDC public immutable usdc;
    IIdentityRegistry public immutable identity;
    uint256 public nextReceipt = 1;
    mapping(uint256 receiptId => address payer) public payerOf;
    mapping(uint256 receiptId => uint256 agentId) public agentOf;
    mapping(uint256 receiptId => IReceiptRegistry.Receipt) internal _receipts;

    error NoAgentWalletR(uint256 agentId);

    constructor(MockUSDC usdc_, IIdentityRegistry identity_) {
        usdc = usdc_;
        identity = identity_;
    }

    function payWithAuthorization(
        uint256 agentId,
        address token,
        address from,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        bytes calldata signature
    ) external returns (uint256 receiptId) {
        if (identity.getAgentWallet(agentId) == address(0)) revert NoAgentWalletR(agentId);
        _pull(token, from, value, validAfter, validBefore, keccak256(abi.encode(agentId, salt)), signature);
        usdc.transfer(identity.getAgentWallet(agentId), value);
        receiptId = nextReceipt++;
        payerOf[receiptId] = from;
        agentOf[receiptId] = agentId;
        _receipts[receiptId] = IReceiptRegistry.Receipt(
            agentId, from, token, uint96(value), uint40(block.timestamp), IReceiptRegistry.ReceiptStatus.Issued
        );
    }

    function receipts() external view returns (address) {
        return address(this);
    }

    function get(uint256 id) external view returns (IReceiptRegistry.Receipt memory) {
        return _receipts[id];
    }

    function _pull(
        address token,
        address from,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) private {
        IMockUSDC3009(token)
            .receiveWithAuthorization(
                from,
                address(this),
                value,
                validAfter,
                validBefore,
                nonce,
                uint8(signature[64]),
                bytes32(signature[0:32]),
                bytes32(signature[32:64])
            );
    }

    function authorizationNonce(uint256 agentId, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(agentId, salt));
    }
}

contract MockIdentity is IIdentityRegistry {
    mapping(uint256 => address) public owners;
    mapping(uint256 => address) public wallets;
    mapping(uint256 => address) public approved;
    mapping(address => mapping(address => bool)) public operators;

    function setAgent(uint256 agentId, address owner_, address wallet_) external {
        owners[agentId] = owner_;
        wallets[agentId] = wallet_;
    }

    function setWallet(uint256 agentId, address wallet_) external {
        wallets[agentId] = wallet_;
    }

    function setApproved(uint256 agentId, address who) external {
        approved[agentId] = who;
    }

    function setOperator(address owner_, address op, bool ok) external {
        operators[owner_][op] = ok;
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        return owners[agentId];
    }

    function getApproved(uint256 agentId) external view returns (address) {
        return approved[agentId];
    }

    function isApprovedForAll(address owner_, address op) external view returns (bool) {
        return operators[owner_][op];
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return wallets[agentId];
    }
}

contract MockGrounded is IGroundedReputation {
    mapping(uint256 => uint8) public score;
    mapping(uint256 => uint32) public reviewers;

    function set(uint256 agentId, uint8 score_, uint32 reviewers_) external {
        score[agentId] = score_;
        reviewers[agentId] = reviewers_;
    }

    function meets(uint256 agentId, uint8 minScore, uint32 minReviewers) external view returns (bool) {
        return reviewers[agentId] >= minReviewers && score[agentId] >= minScore;
    }
}
