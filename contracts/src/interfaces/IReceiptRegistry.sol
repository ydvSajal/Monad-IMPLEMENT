// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Vendored interface. Source: Grounded contracts/src/ReceiptRegistry.sol + types/GroundedTypes.sol.
interface IReceiptRegistry {
    enum ReceiptStatus {
        None,
        Issued,
        Consumed
    }

    struct Receipt {
        uint256 agentId;
        address payer;
        address token;
        uint96 amount;
        uint40 paidAt;
        ReceiptStatus status;
    }

    function get(uint256 id) external view returns (Receipt memory);
}
