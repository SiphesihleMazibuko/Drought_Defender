// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract WaterVoucher {
    enum Status { Missing, Issued, Redeemed }
    struct Voucher { uint256 litres; Status status; }

    address public immutable issuer;
    address public immutable redeemer;
    address public immutable secondRedeemer;
    mapping(bytes32 => Voucher) public vouchers;

    error InvalidStaff();
    error Unauthorized();
    error InvalidVoucher();
    error DuplicateVoucher();
    error VoucherNotIssued();

    event VoucherIssued(bytes32 indexed id, uint256 litres);
    event VoucherRedeemed(bytes32 indexed id, uint256 litres);

    constructor(address cooperative, address collectionPoint, address secondCollectionPoint) {
        if (cooperative == address(0) || collectionPoint == address(0) || secondCollectionPoint == address(0) ||
            cooperative == collectionPoint || cooperative == secondCollectionPoint || collectionPoint == secondCollectionPoint) {
            revert InvalidStaff();
        }
        issuer = cooperative;
        redeemer = collectionPoint;
        secondRedeemer = secondCollectionPoint;
    }

    function issue(bytes32 id, uint256 litres) external {
        if (msg.sender != issuer) revert Unauthorized();
        if (id == bytes32(0) || litres == 0) revert InvalidVoucher();
        if (vouchers[id].status != Status.Missing) revert DuplicateVoucher();
        vouchers[id] = Voucher(litres, Status.Issued);
        emit VoucherIssued(id, litres);
    }

    function redeem(bytes32 id) external {
        if (msg.sender != redeemer && msg.sender != secondRedeemer) revert Unauthorized();
        Voucher storage voucher = vouchers[id];
        if (voucher.status != Status.Issued) revert VoucherNotIssued();
        voucher.status = Status.Redeemed;
        emit VoucherRedeemed(id, voucher.litres);
    }
}
