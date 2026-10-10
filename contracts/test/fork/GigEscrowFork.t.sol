// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {GigEscrow} from "../../src/GigEscrow.sol";
import {IGroundedReputation} from "../../src/interfaces/IGroundedReputation.sol";
import {IIdentityRegistry} from "../../src/interfaces/IIdentityRegistry.sol";
import {IReceiptRouter} from "../../src/interfaces/IReceiptRouter.sol";

interface IReceiptRegistry {
    function get(uint256 receiptId)
        external
        view
        returns (uint256 agentId, address payer, address token, uint96 amount, uint40 paidAt, uint8 status);
}

/// @dev Opt-in: `MONAD_FORK_RPC=https://testnet-rpc.monad.xyz forge test --match-path "test/fork/*"`.
///      Real USDC, real Grounded, real ERC-8004 identity.
contract GigEscrowForkTest is Test {
    IERC20 constant USDC = IERC20(0x534b2f3A21130d7a60830c2Df862319e593943A3);
    IReceiptRouter constant ROUTER = IReceiptRouter(0xab442c3cbc2997a6218FEA0DD253c3717edfc62e);
    IGroundedReputation constant GROUNDED = IGroundedReputation(0xaDDd1f2F876CD253C57177b675905Bdb0061bF82);
    IIdentityRegistry constant IDENTITY = IIdentityRegistry(0x8004A818BFB912233c491871b3d84c89A494BD9e);
    address constant RECEIPTS = 0xa89b76Ea9AcEA12A66Fb23d318219b9119362301;
    uint256 constant AGENT = 1; // live agent with a payout wallet

    bytes32 constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    GigEscrow escrow;
    uint256 clientPk = 0xC11E;
    address client;
    address feeTo = address(0xFEE);
    address owner;
    address wallet;

    function setUp() public {
        string memory rpc = vm.envOr("MONAD_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);

        client = vm.addr(clientPk);
        owner = IDENTITY.ownerOf(AGENT);
        wallet = IDENTITY.getAgentWallet(AGENT);
        escrow = new GigEscrow(USDC, ROUTER, GROUNDED, IDENTITY, feeTo, 500, 7 days);
        deal(address(USDC), client, 1000e6);
        vm.prank(client);
        USDC.approve(address(escrow), type(uint256).max);
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("USDC"),
                keccak256("2"),
                block.chainid,
                address(USDC)
            )
        );
    }

    function _sign(uint256 agentId, uint256 value, uint256 validBefore, bytes32 salt)
        internal
        view
        returns (bytes memory)
    {
        bytes32 nonce = ROUTER.authorizationNonce(agentId, salt);
        bytes32 structHash =
            keccak256(abi.encode(RECEIVE_TYPEHASH, client, address(ROUTER), value, uint256(0), validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(clientPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_fork_release_receiptPayerIsClient() public {
        vm.prank(client);
        uint256 id = escrow.create(1e6, 0, 0, uint40(block.timestamp + 1 days), 3 days, address(0), keccak256("j"));
        vm.prank(owner);
        escrow.accept(id, AGENT);

        uint256 walletBefore = USDC.balanceOf(wallet);
        uint256 validBefore = block.timestamp + 1 hours;
        bytes memory sig = _sign(AGENT, 1e6, validBefore, bytes32("salt"));
        vm.prank(client);
        uint256 receiptId = escrow.release(id, 0, validBefore, bytes32("salt"), sig);

        (uint256 agentId, address payer,,,,) = IReceiptRegistry(RECEIPTS).get(receiptId);
        assertEq(agentId, AGENT);
        assertEq(payer, client);
        assertEq(USDC.balanceOf(wallet) - walletBefore, 1e6);
        assertEq(USDC.balanceOf(feeTo), 50_000);
        assertEq(USDC.balanceOf(address(escrow)), 0);
    }

    function test_fork_signatureForOtherAgentReverts() public {
        vm.prank(client);
        uint256 id = escrow.create(1e6, 0, 0, uint40(block.timestamp + 1 days), 3 days, address(0), 0);
        vm.prank(owner);
        escrow.accept(id, AGENT);
        uint256 validBefore = block.timestamp + 1 hours;
        bytes memory sig = _sign(AGENT + 1, 1e6, validBefore, bytes32("salt")); // nonce for another agent
        vm.prank(client);
        vm.expectRevert();
        escrow.release(id, 0, validBefore, bytes32("salt"), sig);
        assertEq(USDC.balanceOf(address(escrow)), 1_050_000);
    }

    function test_fork_signatureForWrongAmountReverts() public {
        vm.prank(client);
        uint256 id = escrow.create(1e6, 0, 0, uint40(block.timestamp + 1 days), 3 days, address(0), 0);
        vm.prank(owner);
        escrow.accept(id, AGENT);
        uint256 validBefore = block.timestamp + 1 hours;
        bytes memory sig = _sign(AGENT, 2e6, validBefore, bytes32("salt"));
        vm.prank(client);
        vm.expectRevert();
        escrow.release(id, 0, validBefore, bytes32("salt"), sig);
        assertEq(USDC.balanceOf(address(escrow)), 1_050_000);
    }

    function test_fork_trustBarRefusesUnqualifiedAgent() public {
        vm.prank(client);
        uint256 id = escrow.create(1e6, 100, 1_000_000, uint40(block.timestamp + 1 days), 3 days, address(0), 0);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(GigEscrow.AgentNotTrusted.selector, AGENT));
        escrow.accept(id, AGENT);
    }

    function test_fork_openJobAcceptsAnyAgentWithWallet() public {
        vm.prank(client);
        uint256 id = escrow.create(1e6, 0, 0, uint40(block.timestamp + 1 days), 3 days, address(0), 0);
        vm.prank(owner);
        escrow.accept(id, AGENT);
    }

    function test_fork_disputeSettlement_receiptPayerIsClient() public {
        vm.prank(client);
        uint256 id = escrow.create(1e6, 0, 0, uint40(block.timestamp + 1 days), 3 days, address(0), 0);
        vm.startPrank(owner);
        escrow.accept(id, AGENT);
        escrow.deliver(id, 0);
        vm.stopPrank();
        vm.prank(client);
        escrow.dispute(id, 0);
        vm.prank(owner);
        escrow.offerSettlement(id, 400_000);

        uint256 clientBefore = USDC.balanceOf(client);
        uint256 validBefore = block.timestamp + 1 hours;
        bytes memory sig = _sign(AGENT, 400_000, validBefore, bytes32("settle"));
        vm.prank(client);
        uint256 receiptId = escrow.settle(id, 400_000, 0, validBefore, bytes32("settle"), sig);

        (, address payer,,,,) = IReceiptRegistry(RECEIPTS).get(receiptId);
        assertEq(payer, client);
        assertEq(USDC.balanceOf(feeTo), 20_000);
        assertEq(USDC.balanceOf(client) - clientBefore, 600_000 + 30_000);
        assertEq(USDC.balanceOf(address(escrow)), 0);
    }

    function test_fork_claimPaid_afterFrontRun() public {
        vm.prank(client);
        uint256 id = escrow.create(1e6, 0, 0, uint40(block.timestamp + 1 days), 3 days, address(0), 0);
        vm.prank(owner);
        escrow.accept(id, AGENT);
        uint256 validBefore = block.timestamp + 1 hours;
        bytes memory sig = _sign(AGENT, 1e6, validBefore, bytes32("salt"));

        // someone copies the signature from the mempool and relays it to the real router first
        vm.prank(address(0xBAD));
        uint256 receiptId =
            ROUTER.payWithAuthorization(AGENT, address(USDC), client, 1e6, 0, validBefore, bytes32("salt"), sig);
        vm.prank(client);
        vm.expectRevert();
        escrow.release(id, 0, validBefore, bytes32("salt"), sig);

        uint256 clientBefore = USDC.balanceOf(client);
        vm.prank(client);
        escrow.claimPaid(id, receiptId);
        assertEq(USDC.balanceOf(client) - clientBefore, 1e6); // reimbursed
        assertEq(USDC.balanceOf(client), 1000e6 - 1_050_000); // paid exactly once overall
        assertEq(USDC.balanceOf(feeTo), 50_000);
        assertEq(USDC.balanceOf(address(escrow)), 0);
    }

    function test_fork_blacklistedFeeRecipientDoesNotFreezeRelease() public {
        (bool ok, bytes memory ret) = address(USDC).staticcall(abi.encodeWithSignature("blacklister()"));
        assertTrue(ok);
        address blacklister = abi.decode(ret, (address));
        vm.prank(blacklister);
        (ok,) = address(USDC).call(abi.encodeWithSignature("blacklist(address)", feeTo));
        assertTrue(ok);

        vm.prank(client);
        uint256 id = escrow.create(1e6, 0, 0, uint40(block.timestamp + 1 days), 3 days, address(0), 0);
        vm.prank(owner);
        escrow.accept(id, AGENT);
        uint256 walletBefore = USDC.balanceOf(wallet);
        uint256 validBefore = block.timestamp + 1 hours;
        bytes memory sig = _sign(AGENT, 1e6, validBefore, bytes32("salt"));
        vm.prank(client);
        escrow.release(id, 0, validBefore, bytes32("salt"), sig);
        assertEq(USDC.balanceOf(wallet) - walletBefore, 1e6);
        assertEq(escrow.owed(feeTo), 50_000);
    }
}
