// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Vendored interface. Source: Grounded contracts/src/interfaces/IIdentityRegistry.sol (ERC-8004 subset).
interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function getApproved(uint256 agentId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function getAgentWallet(uint256 agentId) external view returns (address);
}
