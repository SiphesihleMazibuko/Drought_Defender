import assert from "node:assert/strict";
import { test } from "node:test";
import ganache from "ganache";
import { BrowserProvider, ContractFactory, id } from "ethers";
import { compileVoucher } from "../scripts/compile-voucher.mjs";

test("voucher permissions, issuance, redemption and replay protection", async () => {
  const chain = ganache.provider({ logging: { quiet: true }, chain: { hardfork: "shanghai" } });
  const provider = new BrowserProvider(chain);
  try {
    const [deployer, issuer, redeemer, stranger, second] = await Promise.all([0, 1, 2, 3, 4].map(i => provider.getSigner(i)));
    const { abi, bytecode } = compileVoucher();
    const voucher = await new ContractFactory(abi, bytecode, deployer).deploy(issuer.address, redeemer.address, second.address);
    await voucher.waitForDeployment();
    const voucherId = id("demo request");
    const expectRevert = error => value => value.revert?.name === error ||
      (value.code === "CALL_EXCEPTION" && value.data?.startsWith(voucher.interface.getError(error).selector));

    await assert.rejects(voucher.connect(stranger).issue.staticCall(voucherId, 80), expectRevert("Unauthorized"));
    await assert.rejects(voucher.connect(redeemer).issue.staticCall(voucherId, 80), expectRevert("Unauthorized"));
    await assert.rejects(voucher.connect(redeemer).redeem.staticCall(voucherId), expectRevert("VoucherNotIssued"));
    const issued = await (await voucher.connect(issuer).issue(voucherId, 80)).wait();
    assert.equal(voucher.interface.parseLog(issued.logs[0]).name, "VoucherIssued");
    assert.deepEqual(Array.from(await voucher.vouchers(voucherId)), [80n, 1n]);
    await assert.rejects(voucher.connect(issuer).issue.staticCall(voucherId, 80), expectRevert("DuplicateVoucher"));
    await assert.rejects(voucher.connect(issuer).redeem.staticCall(voucherId), expectRevert("Unauthorized"));
    await assert.rejects(voucher.connect(stranger).redeem.staticCall(voucherId), expectRevert("Unauthorized"));
    const redeemed = await (await voucher.connect(redeemer).redeem(voucherId)).wait();
    assert.equal(voucher.interface.parseLog(redeemed.logs[0]).name, "VoucherRedeemed");
    assert.deepEqual(Array.from(await voucher.vouchers(voucherId)), [80n, 2n]);
    assert.equal(await voucher.secondRedeemer(), second.address);
    await assert.rejects(voucher.connect(second).redeem.staticCall(voucherId), expectRevert("VoucherNotIssued"));
    await assert.rejects(voucher.connect(redeemer).redeem.staticCall(voucherId), expectRevert("VoucherNotIssued"));
  } finally {
    provider.destroy();
    await chain.disconnect();
  }
});
