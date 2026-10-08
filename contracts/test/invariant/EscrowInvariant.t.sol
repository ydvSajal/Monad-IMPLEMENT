// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {GigEscrow} from "../../src/GigEscrow.sol";
import {IGroundedReputation} from "../../src/interfaces/IGroundedReputation.sol";
import {IIdentityRegistry} from "../../src/interfaces/IIdentityRegistry.sol";
import {IReceiptRouter} from "../../src/interfaces/IReceiptRouter.sol";
import {MockUSDC, MockRouter, MockIdentity, MockGrounded} from "../mocks/Mocks.sol";

contract Handler is Test {
    GigEscrow public escrow;
    MockUSDC public usdc;
    address public client = address(0xC1);
    address public freelancer = address(0xF1);
    address public arbiter = address(0xA8);
    uint256 public maxId;

    constructor(GigEscrow e, MockUSDC u) {
        escrow = e;
        usdc = u;
        usdc.mint(client, 1e18);
        vm.prank(client);
        usdc.approve(address(e), type(uint256).max);
    }

    function create(uint96 amount) external {
        amount = uint96(bound(amount, 10_000, 1000e6));
        vm.prank(client);
        escrow.create(amount, 0, 0, uint40(block.timestamp + 1 days), 3 days, arbiter, 0);
        maxId = escrow.nextJobId() - 1;
    }

    function accept(uint256 id) external {
        if (maxId == 0) return;
        vm.prank(freelancer);
        try escrow.accept(bound(id, 1, maxId), 7) {} catch {}
    }

    function deliver(uint256 id) external {
        if (maxId == 0) return;
        vm.prank(freelancer);
        try escrow.deliver(bound(id, 1, maxId), 0) {} catch {}
    }

    function release(uint256 id, bytes32 salt) external {
        if (maxId == 0) return;
        bytes memory sig = new bytes(65);
        sig[64] = bytes1(uint8(1));
        vm.prank(client);
        try escrow.release(bound(id, 1, maxId), 0, block.timestamp + 1 hours, salt, sig) {} catch {}
    }

    function autoRelease(uint256 id) external {
        if (maxId == 0) return;
        vm.warp(block.timestamp + 8 days);
        try escrow.autoRelease(bound(id, 1, maxId)) {} catch {}
    }

    function refund(uint256 id, bool asFreelancer) external {
        if (maxId == 0) return;
        vm.warp(block.timestamp + 2 days);
        vm.prank(asFreelancer ? freelancer : client);
        try escrow.refund(bound(id, 1, maxId)) {} catch {}
    }

    function dispute(uint256 id) external {
        if (maxId == 0) return;
        vm.prank(client);
        try escrow.dispute(bound(id, 1, maxId), 0) {} catch {}
    }

    function offerAndSettle(uint256 id, uint96 share, bytes32 salt) external {
        if (maxId == 0) return;
        id = bound(id, 1, maxId);
        share = uint96(bound(share, 0, 1000e6));
        bytes memory sig = new bytes(65);
        sig[64] = bytes1(uint8(1));
        vm.prank(freelancer);
        try escrow.offerSettlement(id, share) {} catch {}
        vm.prank(client);
        try escrow.settle(id, share, 0, block.timestamp + 1 hours, salt, sig) {} catch {}
    }

    function rule(uint256 id, uint96 share) external {
        if (maxId == 0) return;
        vm.prank(arbiter);
        try escrow.rule(bound(id, 1, maxId), uint96(bound(share, 0, 1000e6))) {} catch {}
    }

    function timeout(uint256 id) external {
        if (maxId == 0) return;
        vm.warp(block.timestamp + 8 days);
        try escrow.resolveTimeout(bound(id, 1, maxId)) {} catch {}
    }
}

contract EscrowInvariantTest is StdInvariant, Test {
    MockUSDC usdc;
    GigEscrow escrow;
    Handler handler;

    function setUp() public {
        usdc = new MockUSDC();
        MockIdentity identity = new MockIdentity();
        MockGrounded grounded = new MockGrounded();
        MockRouter router = new MockRouter(usdc, identity);
        escrow = new GigEscrow(
            IERC20(address(usdc)),
            IReceiptRouter(address(router)),
            IGroundedReputation(address(grounded)),
            IIdentityRegistry(address(identity)),
            address(0xFEE),
            500,
            7 days
        );
        identity.setAgent(7, address(0xF1), address(0xAA));
        handler = new Handler(escrow, usdc);
        targetContract(address(handler));
    }

    /// escrow balance == sum(amount + fee) over jobs still holding funds
    function invariant_balanceMatchesOpenJobs() public view {
        uint256 held;
        for (uint256 i = 1; i < escrow.nextJobId(); ++i) {
            GigEscrow.Job memory j = escrow.getJob(i);
            GigEscrow.Status st = j.status;
            if (
                st == GigEscrow.Status.Funded || st == GigEscrow.Status.Accepted || st == GigEscrow.Status.Delivered
                    || st == GigEscrow.Status.Disputed
            ) held += uint256(j.amount) + escrow.feeOf(j.amount);
        }
        assertEq(usdc.balanceOf(address(escrow)), held);
    }
}
