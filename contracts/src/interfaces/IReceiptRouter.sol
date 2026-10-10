// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Vendored interface. Source: Grounded contracts/src/ReceiptRouter.sol.
interface IReceiptRouter {
    function payWithAuthorization(
        uint256 agentId,
        address token,
        address from,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        bytes calldata signature
    ) external returns (uint256 receiptId);

    function authorizationNonce(uint256 agentId, bytes32 salt) external pure returns (bytes32);

    function receipts() external view returns (address);
}
