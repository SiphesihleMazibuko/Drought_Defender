import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import ganache from "ganache";
import { ContractFactory, JsonRpcProvider } from "ethers";
import { compileVoucher } from "../scripts/compile-voucher.mjs";
import vouchers from "../dist/vouchers.js";

test("approval, role checks, confirmed receipts and idempotent retries", async () => {
  const chain = ganache.server({ logging: { quiet: true }, chain: { chainId: 43113, hardfork: "shanghai" } });
  await chain.listen(0, "127.0.0.1");
  const rpc = new JsonRpcProvider(`http://127.0.0.1:${chain.address().port}`);
  const accounts = Object.entries(chain.provider.getInitialAccounts());
  const [, [issuer, issuerAccount], [redeemer, redeemerAccount], [second]] = accounts;
  const app = express();
  app.use(express.json(), vouchers);
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const { abi, bytecode } = compileVoucher();
    const contract = await new ContractFactory(abi, bytecode, await rpc.getSigner()).deploy(issuer, redeemer, second);
    await contract.waitForDeployment();
    Object.assign(process.env, {
      FUJI_RPC_URL: `http://127.0.0.1:${chain.address().port}`,
      FUJI_VOUCHER_ADDRESS: await contract.getAddress(),
      FUJI_ISSUER_PRIVATE_KEY: issuerAccount.secretKey,
      FUJI_REDEEMER_PRIVATE_KEY: redeemerAccount.secretKey,
      VOUCHER_DB_PATH: ":memory:",
      VOUCHER_LOCAL_TEST: "true",
      VOUCHER_ISSUER_CODE: "mock-issuer",
      VOUCHER_REDEEMER_CODE: "mock-redeemer",
      VOUCHER_SECOND_REDEEMER_CODE: "mock-second",
    });

    const farmer = { "x-waterwise-farmer": randomUUID() };
    const cooperative = { Authorization: "Bearer mock-issuer" };
    const collection = { Authorization: "Bearer mock-redeemer" };
    const url = `http://127.0.0.1:${server.address().port}/requests`;
    const query = (path, headers, body) => fetch(url + path, {
      method: body ? "POST" : "GET",
      headers: { ...headers, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const requestId = randomUUID();
    const payload = { requestId, available: 30, scenario: "dry", beds: [
      { crop: "Tomatoes", stage: "Growing", area: 20 / 3 },
      { crop: "Spinach", stage: "Mature", area: 4 },
    ] };
    const create = await query("", farmer, payload);
    assert.equal(create.status, 201);
    const pending = await create.json();
    assert.equal(pending.needed, 70);
    assert.equal(pending.shortfall, 40);
    assert.equal(pending.status, "pending");
    assert.equal((await (await query("", farmer, payload)).json()).id, pending.id);
    assert.equal((await (await query("", { "x-waterwise-farmer": randomUUID() })).json()).length, 0);

    const issue = "/" + requestId + "/issue";
    const redeem = "/" + requestId + "/redeem";
    const approval = { approved: 40, checkedSupply: 45 };
    assert.equal((await query(issue, collection, approval)).status, 403);
    assert.equal((await query(redeem, collection, { handedOver: true })).status, 409);
    assert.equal((await query(issue, cooperative, { approved: 76, checkedSupply: 75 })).status, 400);
    delete process.env.FUJI_ISSUER_PRIVATE_KEY;
    assert.equal((await query(issue, cooperative, approval)).status, 503);
    const failed = (await (await query("", farmer)).json())[0];
    assert.equal(failed.status, "issue_failed");
    assert.equal(failed.approved, 40);
    assert.equal(failed.transactions.length, 0);
    process.env.FUJI_ISSUER_PRIVATE_KEY = issuerAccount.secretKey;
    const issuedPending = await query(issue, cooperative, { approved: 60, checkedSupply: 75 });
    assert.equal(issuedPending.status, 202);
    const first = await issuedPending.json();
    assert.equal(first.status, "issue_pending");
    assert.equal(first.transactions.length, 1);
    const retry = (await (await query(issue, cooperative, approval)).json()).transactions;
    assert.equal(retry.length, 1);
    assert.equal(retry[0].hash, first.transactions[0].hash);
    assert.equal((await (await query("", farmer)).json())[0].status, "issue_pending");
    await rpc.send("evm_mine", []);
    await new Promise(resolve => setTimeout(resolve, 350));
    const issued = (await (await query("", farmer)).json())[0];
    assert.equal(issued.status, "issued", JSON.stringify(await rpc.getTransactionReceipt(first.transactions[0].hash)));
    assert.deepEqual(Array.from(await contract.vouchers(issued.voucherId)), [40n, 1n]);

    assert.equal((await query(redeem, cooperative, { handedOver: true })).status, 403);
    assert.equal((await query(redeem, collection, {})).status, 400);
    const redeeming = await query(redeem, collection, { handedOver: true });
    assert.equal(redeeming.status, 202);
    assert.equal((await redeeming.json()).status, "redeem_pending");
    await rpc.send("evm_mine", []);
    await new Promise(resolve => setTimeout(resolve, 350));
    const finished = (await (await query("", farmer)).json())[0];
    assert.equal(finished.status, "redeemed");
    assert.equal(finished.transactions.length, 2);
    const replay = "/" + requestId + "/replay";
    assert.equal((await query(replay, collection, {})).status, 403);
    const blocked = await query(replay, { Authorization: "Bearer mock-second" }, {});
    assert.equal(blocked.status, 200);
    assert.match((await blocked.json()).message, /blocked by the contract/);
    assert.equal((await (await query("", farmer)).json())[0].transactions.length, 2);
    const repeat = await query(redeem, collection, {});
    assert.deepEqual(await repeat.json(), finished);
  } finally {
    server.close();
    rpc.destroy();
    await chain.close();
  }
});
