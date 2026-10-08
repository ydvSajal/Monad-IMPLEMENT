// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Vendored interface. Source: Grounded (https://grounded.sajal.sbs), contracts/src/interfaces/IGroundedReputation.sol.
interface IGroundedReputation {
    function meets(uint256 agentId, uint8 minScore, uint32 minReviewers) external view returns (bool);
}
