// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {GigEscrow} from "../../src/GigEscrow.sol";
import {IGroundedReputation} from "../../src/interfaces/IGroundedReputation.sol";
import {IIdentityRegistry} from "../../src/interfaces/IIdentityRegistry.sol";
import {IReceiptRouter} from "../../src/interfaces/IReceiptRouter.sol";
import {MockUSDC, MockRouter, MockIdentity, MockGrounded} from "../mocks/Mocks.sol";

contract GigEscrowTest is Test {
    MockUSDC usdc;
    MockRouter router;
    MockIdentity identity;
    MockGrounded grounded;
    GigEscrow escrow;

    address client = makeAddr("client");
    address freelancer = makeAddr("freelancer");
    address wallet = makeAddr("wallet");
    address feeTo = makeAddr("feeTo");
    address stranger = makeAddr("stranger");

    uint256 constant AMOUNT = 100e6;
    uint256 constant FEE = 5e6;
    uint256 constant AGENT = 7;

    function setUp() public {
        usdc = new MockUSDC();
        identity = new MockIdentity();
        grounded = new MockGrounded();
        router = new MockRouter(usdc, identity);
        escrow = new GigEscrow(
            IERC20(address(usdc)),
            IReceiptRouter(address(router)),
            IGroundedReputation(address(grounded)),
            IIdentityRegistry(address(identity)),
            feeTo,
            500,
            7 days
        );
        identity.setAgent(AGENT, freelancer, wallet);
        usdc.mint(client, 1000e6);
        vm.prank(client);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _create(uint8 minScore, uint32 minReviewers) internal returns (uint256) {
        vm.prank(client);
        return escrow.create(
            AMOUNT, minScore, minReviewers, uint40(block.timestamp + 1 days), 3 days, address(0), keccak256("job")
        );
    }

    function _sig() internal pure returns (bytes memory s) {
        s = new bytes(65);
        s[64] = bytes1(uint8(1));
    }

    function _accepted(uint8 minScore, uint32 minRev) internal returns (uint256 id) {
        grounded.set(AGENT, 90, 5);
        id = _create(minScore, minRev);
        vm.prank(freelancer);
        escrow.accept(id, AGENT);
    }

    function _release(uint256 id) internal returns (uint256) {
        vm.prank(client);
        return escrow.release(id, 0, block.timestamp + 1 hours, bytes32("salt"), _sig());
    }

    // ---- create
    function test_create_pullsAmountPlusFee() public {
        uint256 id = _create(0, 0);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT + FEE);
        assertEq(usdc.balanceOf(client), 1000e6 - AMOUNT - FEE);
        GigEscrow.Job memory j = escrow.getJob(id);
        assertEq(j.client, client);
        assertEq(uint8(j.status), uint8(GigEscrow.Status.Funded));
        (uint32 posted,,) = escrow.clientStats(client);
        assertEq(posted, 1);
    }

    function test_create_reverts() public {
        vm.startPrank(client);
        vm.expectRevert(GigEscrow.AmountBelowMinimum.selector);
        escrow.create(9999, 0, 0, uint40(block.timestamp + 1), 3 days, address(0), 0);
        vm.expectRevert(GigEscrow.BadParams.selector);
        escrow.create(AMOUNT, 101, 0, uint40(block.timestamp + 1), 3 days, address(0), 0);
        vm.expectRevert(GigEscrow.BadParams.selector);
        escrow.create(AMOUNT, 0, 0, uint40(block.timestamp), 3 days, address(0), 0);
        vm.expectRevert(GigEscrow.AmountTooLarge.selector);
        escrow.create(uint256(type(uint96).max) + 1, 0, 0, uint40(block.timestamp + 1), 3 days, address(0), 0);
        vm.stopPrank();
    }

    function test_constructor_rejectsBadParams() public {
        vm.expectRevert(GigEscrow.BadParams.selector);
        new GigEscrow(
            IERC20(address(usdc)),
            IReceiptRouter(address(router)),
            IGroundedReputation(address(grounded)),
            IIdentityRegistry(address(identity)),
            address(0),
            500,
            7 days
        );
        vm.expectRevert(GigEscrow.BadParams.selector);
        new GigEscrow(
            IERC20(address(usdc)),
            IReceiptRouter(address(router)),
            IGroundedReputation(address(grounded)),
            IIdentityRegistry(address(identity)),
            feeTo,
            500,
            0
        );
    }

    // ---- accept
    function test_accept_openJob_unratedAgent() public {
        uint256 id = _create(0, 0);
        vm.prank(freelancer);
        escrow.accept(id, AGENT);
        GigEscrow.Job memory j = escrow.getJob(id);
        assertEq(j.agentId, AGENT);
        assertEq(uint8(j.status), uint8(GigEscrow.Status.Accepted));
        assertEq(j.deadline, block.timestamp + 3 days);
    }

    function test_accept_revertsAgentNotTrusted() public {
        uint256 id = _create(70, 3);
        grounded.set(AGENT, 50, 10); // score too low
        vm.prank(freelancer);
        vm.expectRevert(abi.encodeWithSelector(GigEscrow.AgentNotTrusted.selector, AGENT));
        escrow.accept(id, AGENT);
    }

    function test_accept_trustedAgent() public {
        uint256 id = _create(70, 3);
        grounded.set(AGENT, 80, 3);
        vm.prank(freelancer);
        escrow.accept(id, AGENT);
    }

    function test_accept_operatorsAllowed() public {
        uint256 id = _create(0, 0);
        address op = makeAddr("op");
        identity.setApproved(AGENT, op);
        vm.prank(op);
        escrow.accept(id, AGENT);
    }

    function test_accept_revertsNotOperator() public {
        uint256 id = _create(0, 0);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(GigEscrow.NotAgentOperator.selector, AGENT));
        escrow.accept(id, AGENT);
    }

    function test_accept_revertsNoWallet() public {
        uint256 id = _create(0, 0);
        identity.setWallet(AGENT, address(0));
        vm.prank(freelancer);
        vm.expectRevert(abi.encodeWithSelector(GigEscrow.NoAgentWallet.selector, AGENT));
        escrow.accept(id, AGENT);
    }

    function test_accept_revertsTooLate() public {
        uint256 id = _create(0, 0);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(freelancer);
        vm.expectRevert(GigEscrow.TooLate.selector);
        escrow.accept(id, AGENT);
    }

    function test_accept_revertsBadStatus() public {
        uint256 id = _accepted(0, 0);
        vm.prank(freelancer);
        vm.expectRevert(abi.encodeWithSelector(GigEscrow.BadStatus.selector, GigEscrow.Status.Accepted));
        escrow.accept(id, AGENT);
    }

    // ---- deliver
    function test_deliver() public {
        uint256 id = _accepted(0, 0);
        vm.prank(freelancer);
        escrow.deliver(id, keccak256("work"));
        GigEscrow.Job memory j = escrow.getJob(id);
        assertEq(j.deliveredAt, block.timestamp);
        assertEq(uint8(j.status), uint8(GigEscrow.Status.Delivered));
    }

    function test_deliver_reverts() public {
        uint256 id = _create(0, 0);
        vm.prank(freelancer);
        vm.expectRevert(abi.encodeWithSelector(GigEscrow.BadStatus.selector, GigEscrow.Status.Funded));
        escrow.deliver(id, 0);
        vm.prank(freelancer);
        escrow.accept(id, AGENT);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(GigEscrow.NotAgentOperator.selector, AGENT));
        escrow.deliver(id, 0);
    }

    // ---- release
    function test_release_afterDelivery_payerIsClient() public {
        uint256 id = _accepted(0, 0);
        vm.prank(freelancer);
        escrow.deliver(id, 0);
        uint256 receiptId = _release(id);
        assertEq(router.payerOf(receiptId), client);
        assertEq(router.agentOf(receiptId), AGENT);
        assertEq(usdc.balanceOf(wallet), AMOUNT);
        assertEq(usdc.balanceOf(feeTo), FEE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(usdc.balanceOf(client), 1000e6 - AMOUNT - FEE);
    }

    function test_release_beforeDelivery_ok() public {
        uint256 id = _accepted(0, 0);
        _release(id);
        assertEq(usdc.balanceOf(wallet), AMOUNT);
    }

    function test_release_badSignatureRevertsAtomically() public {
        uint256 id = _accepted(0, 0);
        vm.prank(client);
        vm.expectRevert(MockUSDC.InvalidSignature.selector);
        escrow.release(id, 0, block.timestamp + 1 hours, bytes32("s"), new bytes(65)); // v = 0
        // client did not keep the amount, job still open
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT + FEE);
        assertEq(uint8(escrow.getJob(id).status), uint8(GigEscrow.Status.Accepted));
    }

    function test_release_walletUnsetRevertsAtomically() public {
        uint256 id = _accepted(0, 0);
        identity.setWallet(AGENT, address(0));
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(MockRouter.NoAgentWalletR.selector, AGENT));
        escrow.release(id, 0, block.timestamp + 1 hours, bytes32("s"), _sig());
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT + FEE);
    }

    function test_release_onlyClient() public {
        uint256 id = _accepted(0, 0);
        vm.prank(freelancer);
        vm.expectRevert(GigEscrow.NotClient.selector);
        escrow.release(id, 0, block.timestamp + 1 hours, bytes32("s"), _sig());
    }

    function test_release_twiceReverts() public {
        uint256 id = _accepted(0, 0);
        _release(id);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(GigEscrow.BadStatus.selector, GigEscrow.Status.Released));
        escrow.release(id, 0, block.timestamp + 1 hours, bytes32("s2"), _sig());
    }

    function test_release_fundedReverts() public {
        uint256 id = _create(0, 0);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(GigEscrow.BadStatus.selector, GigEscrow.Status.Funded));
        escrow.release(id, 0, block.timestamp + 1 hours, bytes32("s"), _sig());
    }

    // ---- autoRelease
    function test_autoRelease_afterWindow() public {
        uint256 id = _accepted(0, 0);
        vm.prank(freelancer);
        escrow.deliver(id, 0);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(stranger);
        escrow.autoRelease(id);
        assertEq(usdc.balanceOf(wallet), AMOUNT);
        assertEq(usdc.balanceOf(feeTo), FEE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_autoRelease_paysOwnerIfWalletCleared() public {
        uint256 id = _accepted(0, 0);
        vm.prank(freelancer);
        escrow.deliver(id, 0);
        identity.setWallet(AGENT, address(0));
        vm.warp(block.timestamp + 7 days + 1);
        escrow.autoRelease(id);
        assertEq(usdc.balanceOf(freelancer), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_autoRelease_tooEarly() public {
        uint256 id = _accepted(0, 0);
        vm.prank(freelancer);
        escrow.deliver(id, 0);
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(GigEscrow.TooEarly.selector);
        escrow.autoRelease(id);
    }

    function test_autoRelease_requiresDelivered() public {
        uint256 id = _accepted(0, 0);
        vm.expectRevert(abi.encodeWithSelector(GigEscrow.BadStatus.selector, GigEscrow.Status.Accepted));
        escrow.autoRelease(id);
    }

    // ---- refund
    function test_refund_clientAfterAcceptBy() public {
        uint256 id = _create(0, 0);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(client);
        escrow.refund(id);
        assertEq(usdc.balanceOf(client), 1000e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_refund_clientTooEarly() public {
        uint256 id = _create(0, 0);
        vm.prank(client);
        vm.expectRevert(GigEscrow.TooEarly.selector);
        escrow.refund(id);
    }

    function test_refund_fundedNotClient() public {
        uint256 id = _create(0, 0);
        vm.warp(block.timestamp + 2 days);
        vm.prank(stranger);
        vm.expectRevert(GigEscrow.NotClient.selector);
        escrow.refund(id);
    }

    function test_refund_freelancerWithdraws() public {
        uint256 id = _accepted(0, 0);
        vm.prank(freelancer);
        escrow.refund(id);
        assertEq(usdc.balanceOf(client), 1000e6);
    }

    function test_refund_clientCannotPullAcceptedJob() public {
        uint256 id = _accepted(0, 0);
        vm.prank(client);
        vm.expectRevert(GigEscrow.NotRefundable.selector);
        escrow.refund(id);
    }

    function test_refund_deliveredReverts() public {
        uint256 id = _accepted(0, 0);
        vm.prank(freelancer);
        escrow.deliver(id, 0);
        vm.prank(freelancer);
        vm.expectRevert(abi.encodeWithSelector(GigEscrow.BadStatus.selector, GigEscrow.Status.Delivered));
        escrow.refund(id);
    }

    // ---- ghosting freelancer
    function test_refund_clientAfterDeliverDeadline() public {
        uint256 id = _accepted(0, 0);
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(client);
        escrow.refund(id);
        assertEq(usdc.balanceOf(client), 1000e6);
    }

    function test_refund_clientBeforeDeliverDeadlineReverts() public {
        uint256 id = _accepted(0, 0);
        vm.warp(block.timestamp + 3 days);
        vm.prank(client);
        vm.expectRevert(GigEscrow.NotRefundable.selector);
        escrow.refund(id);
    }

    function test_create_rejectsSelfArbiterAndZeroDeliverWindow() public {
        vm.startPrank(client);
        vm.expectRevert(GigEscrow.BadParams.selector);
        escrow.create(AMOUNT, 0, 0, uint40(block.timestamp + 1 days), 3 days, client, 0);
        vm.expectRevert(GigEscrow.BadParams.selector);
        escrow.create(AMOUNT, 0, 0, uint40(block.timestamp + 1 days), 0, address(0), 0);
        vm.stopPrank();
    }

    // ---- disputes
    address arbiter = makeAddr("arbiter");

    function _disputed(address arb) internal returns (uint256 id) {
        vm.prank(client);
        id = escrow.create(AMOUNT, 0, 0, uint40(block.timestamp + 1 days), 3 days, arb, 0);
        vm.startPrank(freelancer);
        escrow.accept(id, AGENT);
        escrow.deliver(id, 0);
        vm.stopPrank();
        vm.prank(client);
        escrow.dispute(id, keccak256("late and broken"));
    }

    function test_dispute_blocksAutoRelease() public {
        uint256 id = _disputed(address(0));
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(abi.encodeWithSelector(GigEscrow.BadStatus.selector, GigEscrow.Status.Disputed));
        escrow.autoRelease(id);
        (,, uint32 disputed) = escrow.clientStats(client);
        assertEq(disputed, 1);
    }

    function test_dispute_afterWindowReverts() public {
        uint256 id = _accepted(0, 0);
        vm.prank(freelancer);
        escrow.deliver(id, 0);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(client);
        vm.expectRevert(GigEscrow.TooLate.selector);
        escrow.dispute(id, 0);
    }

    function test_dispute_onlyClient() public {
        uint256 id = _accepted(0, 0);
        vm.prank(freelancer);
        escrow.deliver(id, 0);
        vm.prank(freelancer);
        vm.expectRevert(GigEscrow.NotClient.selector);
        escrow.dispute(id, 0);
    }

    function test_settle_partial_issuesReceiptToClient() public {
        uint256 id = _disputed(address(0));
        vm.prank(freelancer);
        escrow.offerSettlement(id, 60e6);
        vm.prank(client);
        uint256 rid = escrow.settle(id, 60e6, 0, block.timestamp + 1 hours, bytes32("s"), _sig());
        assertEq(router.payerOf(rid), client);
        assertEq(usdc.balanceOf(wallet), 60e6);
        assertEq(usdc.balanceOf(feeTo), 3e6); // 5% of 60
        assertEq(usdc.balanceOf(client), 1000e6 - 60e6 - 3e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getJob(id).status), uint8(GigEscrow.Status.Resolved));
    }

    function test_settle_zero_fullRefund() public {
        uint256 id = _disputed(address(0));
        vm.prank(freelancer);
        escrow.offerSettlement(id, 0);
        vm.prank(client);
        uint256 rid = escrow.settle(id, 0, 0, 0, 0, "");
        assertEq(rid, 0);
        assertEq(usdc.balanceOf(client), 1000e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_settle_requiresMatchingOffer() public {
        uint256 id = _disputed(address(0));
        vm.prank(client);
        vm.expectRevert(GigEscrow.NoOffer.selector);
        escrow.settle(id, 50e6, 0, block.timestamp + 1 hours, bytes32("s"), _sig());
        vm.prank(freelancer);
        escrow.offerSettlement(id, 90e6);
        vm.prank(client);
        vm.expectRevert(GigEscrow.NoOffer.selector);
        escrow.settle(id, 50e6, 0, block.timestamp + 1 hours, bytes32("s"), _sig());
    }

    function test_offer_rejectsBadAmounts() public {
        uint256 id = _disputed(address(0));
        vm.startPrank(freelancer);
        vm.expectRevert(GigEscrow.BadParams.selector);
        escrow.offerSettlement(id, uint96(AMOUNT + 1));
        vm.expectRevert(GigEscrow.BadParams.selector);
        escrow.offerSettlement(id, 9999); // below router floor
        vm.stopPrank();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(GigEscrow.NotAgentOperator.selector, AGENT));
        escrow.offerSettlement(id, 50e6);
    }

    function test_rule_arbiterSplits() public {
        uint256 id = _disputed(arbiter);
        vm.prank(arbiter);
        escrow.rule(id, 20e6);
        assertEq(usdc.balanceOf(wallet), 20e6);
        assertEq(usdc.balanceOf(feeTo), 1e6);
        assertEq(usdc.balanceOf(client), 1000e6 - 20e6 - 1e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_rule_onlyArbiter() public {
        uint256 id = _disputed(arbiter);
        vm.prank(client);
        vm.expectRevert(GigEscrow.NotArbiter.selector);
        escrow.rule(id, 0);
        uint256 id2 = _disputed(address(0));
        vm.prank(address(0));
        vm.expectRevert(GigEscrow.NotArbiter.selector);
        escrow.rule(id2, 0);
    }

    function test_rule_paysOwnerIfWalletCleared() public {
        uint256 id = _disputed(arbiter);
        identity.setWallet(AGENT, address(0));
        vm.prank(arbiter);
        escrow.rule(id, uint96(AMOUNT));
        assertEq(usdc.balanceOf(freelancer), AMOUNT);
    }

    function test_timeout_splitsHalf() public {
        uint256 id = _disputed(address(0));
        vm.expectRevert(GigEscrow.TooEarly.selector);
        escrow.resolveTimeout(id);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(stranger);
        escrow.resolveTimeout(id);
        assertEq(usdc.balanceOf(wallet), 50e6);
        assertEq(usdc.balanceOf(feeTo), 2.5e6);
        assertEq(usdc.balanceOf(client), 1000e6 - 50e6 - 2.5e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function testFuzz_ruleNeverLeavesDust(uint96 share) public {
        share = uint96(bound(share, 0, AMOUNT));
        uint256 id = _disputed(arbiter);
        vm.prank(arbiter);
        escrow.rule(id, share);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(wallet) + usdc.balanceOf(feeTo) + usdc.balanceOf(client), 1000e6);
    }

    // ---- fuzz: fee math, escrow never keeps dust
    function testFuzz_feeRoundTrip(uint96 amount) public {
        amount = uint96(bound(amount, 10_000, 100_000e6));
        usdc.mint(client, uint256(amount) * 2);
        vm.prank(client);
        uint256 id = escrow.create(amount, 0, 0, uint40(block.timestamp + 1 days), 3 days, address(0), 0);
        vm.prank(freelancer);
        escrow.accept(id, AGENT);
        vm.prank(client);
        escrow.release(id, 0, block.timestamp + 1 hours, bytes32("s"), _sig());
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(wallet), amount);
        assertEq(usdc.balanceOf(feeTo), escrow.feeOf(amount));
    }

    // ---- front-run recovery: the client's signature was relayed straight to the router
    function _frontRun(uint256 value) internal returns (uint256 receiptId) {
        vm.prank(stranger);
        receiptId = router.payWithAuthorization(
            AGENT, address(usdc), client, value, 0, block.timestamp + 1 hours, bytes32("salt"), _sig()
        );
    }

    function test_claimPaid_afterFrontRunOnRelease() public {
        uint256 id = _accepted(0, 0);
        vm.prank(freelancer);
        escrow.deliver(id, 0);
        uint256 receiptId = _frontRun(AMOUNT); // paid from the client's own wallet
        vm.expectRevert(MockUSDC.AuthorizationUsed.selector);
        _release(id);

        vm.prank(client);
        escrow.claimPaid(id, receiptId);
        assertEq(uint8(escrow.getJob(id).status), uint8(GigEscrow.Status.Released));
        // net effect identical to a normal release: the freelancer was paid once, the client paid once
        assertEq(usdc.balanceOf(wallet), AMOUNT);
        assertEq(usdc.balanceOf(feeTo), FEE);
        assertEq(usdc.balanceOf(client), 1000e6 - AMOUNT - FEE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        // the job is closed, so autoRelease can't pay a second time
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(abi.encodeWithSelector(GigEscrow.BadStatus.selector, GigEscrow.Status.Released));
        escrow.autoRelease(id);
    }

    function test_claimPaid_afterFrontRunOnSettle() public {
        uint256 id = _disputed(address(0));
        vm.prank(freelancer);
        escrow.offerSettlement(id, 60e6);
        uint256 receiptId = _frontRun(60e6);
        vm.prank(client);
        escrow.claimPaid(id, receiptId);
        assertEq(uint8(escrow.getJob(id).status), uint8(GigEscrow.Status.Resolved));
        assertEq(usdc.balanceOf(wallet), 60e6);
        assertEq(usdc.balanceOf(feeTo), 3e6);
        assertEq(usdc.balanceOf(client), 1000e6 - 60e6 - 3e6); // same as settle
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_claimPaid_rejectsBadReceipts() public {
        uint256 id = _accepted(0, 0);
        uint256 other = _create(0, 0);

        uint256 wrongAmount = _frontRunSalt(AMOUNT - 1, "a");
        vm.prank(client);
        vm.expectRevert(GigEscrow.ReceiptMismatch.selector);
        escrow.claimPaid(id, wrongAmount);

        vm.prank(stranger);
        vm.expectRevert(GigEscrow.NotClient.selector);
        escrow.claimPaid(id, wrongAmount);

        // a receipt from before this job was accepted does not count
        uint256 early = _frontRunSalt(AMOUNT, "b");
        vm.warp(block.timestamp + 1);
        vm.prank(freelancer);
        escrow.accept(other, AGENT);
        vm.prank(client);
        vm.expectRevert(GigEscrow.ReceiptMismatch.selector);
        escrow.claimPaid(other, early);

        // one payment can't close two jobs
        uint256 good = _frontRunSalt(AMOUNT, "c");
        vm.prank(client);
        escrow.claimPaid(id, good);
        vm.prank(client);
        vm.expectRevert(GigEscrow.ReceiptMismatch.selector);
        escrow.claimPaid(other, good);

        // nor can a receipt the escrow itself produced through release
        uint256 third = _accepted(0, 0);
        uint256 released = _release(third);
        vm.prank(client);
        vm.expectRevert(GigEscrow.ReceiptMismatch.selector);
        escrow.claimPaid(other, released);
    }

    function test_claimPaid_disputedNeedsOffer() public {
        uint256 id = _disputed(address(0));
        uint256 receiptId = _frontRun(AMOUNT);
        vm.prank(client);
        vm.expectRevert(GigEscrow.NoOffer.selector);
        escrow.claimPaid(id, receiptId);
    }

    function _frontRunSalt(uint256 value, bytes32 salt) internal returns (uint256) {
        vm.prank(stranger);
        return
            router.payWithAuthorization(AGENT, address(usdc), client, value, 0, block.timestamp + 1 hours, salt, _sig());
    }

    // ---- blocked addresses: a payout that can't be pushed is owed, nobody else is frozen
    function test_blockedFeeRecipient_releaseStillPays() public {
        uint256 id = _accepted(0, 0);
        usdc.setBlocked(feeTo, true);
        _release(id);
        assertEq(usdc.balanceOf(wallet), AMOUNT);
        assertEq(escrow.owed(feeTo), FEE);
        assertEq(usdc.balanceOf(address(escrow)), FEE);

        vm.prank(feeTo);
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.Blocked.selector, feeTo));
        escrow.withdraw(); // still blocked: stays owed
        usdc.setBlocked(feeTo, false);
        vm.prank(feeTo);
        escrow.withdraw();
        assertEq(usdc.balanceOf(feeTo), FEE);
        assertEq(escrow.owed(feeTo), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_blockedClient_timeoutStillPaysFreelancer() public {
        uint256 id = _disputed(address(0));
        usdc.setBlocked(client, true);
        vm.warp(block.timestamp + 7 days + 1);
        escrow.resolveTimeout(id);
        assertEq(usdc.balanceOf(wallet), AMOUNT / 2);
        assertEq(escrow.owed(client), AMOUNT / 2 + FEE - escrow.feeOf(AMOUNT / 2));
    }

    function test_blockedFreelancer_autoReleaseStillPaysFee() public {
        uint256 id = _accepted(0, 0);
        vm.prank(freelancer);
        escrow.deliver(id, 0);
        usdc.setBlocked(wallet, true);
        vm.warp(block.timestamp + 7 days + 1);
        escrow.autoRelease(id);
        assertEq(usdc.balanceOf(feeTo), FEE);
        assertEq(escrow.owed(wallet), AMOUNT);
    }

    function test_withdraw_nothingOwed() public {
        vm.expectRevert(GigEscrow.NothingOwed.selector);
        escrow.withdraw();
    }
}
