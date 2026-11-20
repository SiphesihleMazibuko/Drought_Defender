import "dotenv/config";
import { ContractFactory, JsonRpcProvider, Wallet, getAddress } from "ethers";
import { compileVoucher } from "./compile-voucher.mjs";

const { FUJI_RPC_URL, FUJI_DEPLOYER_PRIVATE_KEY, FUJI_ISSUER_ADDRESS, FUJI_REDEEMER_ADDRESS, FUJI_SECOND_REDEEMER_ADDRESS } = process.env;
if (!FUJI_DEPLOYER_PRIVATE_KEY || !FUJI_ISSUER_ADDRESS || !FUJI_REDEEMER_ADDRESS || !FUJI_SECOND_REDEEMER_ADDRESS) {
  throw new Error("Set the Fuji deployer key and all three staff addresses.");
}
if (!/^(0x)?[0-9a-f]{64}$/i.test(FUJI_DEPLOYER_PRIVATE_KEY)) {
  throw new Error("FUJI_DEPLOYER_PRIVATE_KEY must be a 32-byte hex key.");
}
const provider = new JsonRpcProvider(FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc");
try {
  if ((await provider.getNetwork()).chainId !== 43113n) throw new Error("Expected Avalanche Fuji (43113).");
  const deployer = new Wallet(FUJI_DEPLOYER_PRIVATE_KEY, provider);
  const issuer = getAddress(FUJI_ISSUER_ADDRESS);
  const redeemer = getAddress(FUJI_REDEEMER_ADDRESS);
  const secondRedeemer = getAddress(FUJI_SECOND_REDEEMER_ADDRESS);
  if (new Set([issuer, redeemer, secondRedeemer]).size !== 3) throw new Error("Use distinct demo role addresses.");
  if (await provider.getBalance(deployer.address) === 0n) throw new Error("Fund the deployer with Fuji test AVAX.");
  const { abi, bytecode } = compileVoucher();
  const voucher = await new ContractFactory(abi, bytecode, deployer).deploy(issuer, redeemer, secondRedeemer);
  const transaction = voucher.deploymentTransaction();
  console.log("Deployment transaction:", transaction.hash);
  const receipt = await transaction.wait(2, 120_000);
  const address = await voucher.getAddress();
  if (receipt?.status !== 1 || (await provider.getCode(address)) === "0x" ||
      await voucher.issuer() !== issuer || await voucher.redeemer() !== redeemer ||
      await voucher.secondRedeemer() !== secondRedeemer) {
    throw new Error("Deployment verification failed.");
  }
  console.log("Verified Fuji contract:", address);
  console.log("Explorer:", "https://explorer-test.avax.network/c-chain/address/" + address);
} finally {
  provider.destroy();
}
