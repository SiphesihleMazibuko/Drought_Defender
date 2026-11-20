import { DatabaseSync } from "node:sqlite";
import { timingSafeEqual, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Contract, FetchRequest, Interface, JsonRpcProvider, Wallet, getAddress, id, isError, keccak256 } from "ethers";
import { Router } from "express";
import { demoData } from "./routes/routes.js";

type Action = "issue" | "redeem";
type Attempt = {
  action: Action; hash: string; signed: string; contract: string;
  confirmations?: number; local?: boolean;
  status: "pending" | "confirmed" | "failed";
};
type WaterRequest = {
  id: string; owner: string; needed: number; available: number; shortfall: number;
  approved?: number; checkedSupply?: number; contract?: string;
  created: string; attempts: Attempt[]; error?: Action;
};
const abi = [
  "function issuer() view returns (address)",
  "function redeemer() view returns (address)",
  "function secondRedeemer() view returns (address)",
  "error VoucherNotIssued()",
  "function issue(bytes32 id, uint256 litres)",
  "function redeem(bytes32 id)",
  "event VoucherIssued(bytes32 indexed id, uint256 litres)",
  "event VoucherRedeemed(bytes32 indexed id, uint256 litres)",
];
const contractInterface = new Interface(abi);
const router = Router();
router.use("/requests", (_request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stages = ["Seedling", "Growing", "Mature"];
const validLitres = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
let database: DatabaseSync | undefined;
let queue = Promise.resolve();
let provider: JsonRpcProvider | undefined;
const localTest = () => process.env.VOUCHER_LOCAL_TEST === "true";

function db() {
  if (!database) {
    const path = process.env.VOUCHER_DB_PATH || "data/vouchers.sqlite";
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    database = new DatabaseSync(path);
    database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, owner TEXT NOT NULL, record TEXT NOT NULL)");
  }
  return database;
}

function find(requestId: string) {
  const row = db().prepare("SELECT record FROM requests WHERE id = ?").get(requestId);
  return row ? JSON.parse(String(row["record"])) as WaterRequest : undefined;
}

function list(owner?: string) {
  const rows = owner
    ? db().prepare("SELECT record FROM requests WHERE owner = ? ORDER BY rowid DESC").all(owner)
    : db().prepare("SELECT record FROM requests ORDER BY rowid DESC").all();
  return rows.map(row => JSON.parse(String(row["record"])) as WaterRequest);
}

function save(record: WaterRequest) {
  db().prepare("INSERT INTO requests VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record")
    .run(record.id, record.owner, JSON.stringify(record));
}

function serialize<T>(task: () => Promise<T>) {
  const next = queue.then(task);
  queue = next.then(() => {}, () => {});
  return next;
}

function role(authorization: string | undefined): Action | "replay" | undefined {
  const issuer = process.env.VOUCHER_ISSUER_CODE;
  const redeemer = process.env.VOUCHER_REDEEMER_CODE;
  if (!authorization?.startsWith("Bearer ") || !issuer || !redeemer || issuer === redeemer) return;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const supplied = digest(authorization.slice(7));
  if (timingSafeEqual(supplied, digest(issuer))) return "issue";
  if (timingSafeEqual(supplied, digest(redeemer))) return "redeem";
  const second = process.env.VOUCHER_SECOND_REDEEMER_CODE;
  if (second && second !== issuer && second !== redeemer && timingSafeEqual(supplied, digest(second))) return "replay";
}

function publicRecord(record: WaterRequest) {
  const last = record.attempts.at(-1);
  const issued = record.attempts.some(tx => tx.action === "issue" && tx.status === "confirmed");
  const status = last?.status === "pending" ? last.action + "_pending"
    : record.error || last?.status === "failed" ? (record.error ?? last?.action) + "_failed"
    : last?.action === "redeem" && last.status === "confirmed" ? "redeemed"
    : issued ? "issued" : record.approved ? "approved" : "pending";
  return {
    id: record.id, voucherId: id("waterwise:" + record.id), needed: record.needed,
    available: record.available, shortfall: record.shortfall, approved: record.approved,
    checkedSupply: record.checkedSupply, created: record.created, status,
    transactions: record.attempts.map(({ action, hash, status: state, confirmations, local }) => ({ action, hash, status: state, confirmations, local })),
  };
}

async function chain() {
  if (!provider) {
    const url = new URL(process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc");
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) !== localTest()) {
      throw new Error("Local voucher tests require a loopback RPC and VOUCHER_LOCAL_TEST=true");
    }
    const connection = new FetchRequest(url.href);
    connection.timeout = 8000;
    provider = new JsonRpcProvider(connection);
  }
  if ((await provider.getNetwork()).chainId !== 43113n) throw new Error("Expected Fuji");
  return provider;
}

async function refresh(record: WaterRequest) {
  const tx = record.attempts.at(-1);
  if (tx?.status !== "pending" || Boolean(tx.local) !== localTest()) return;
  try {
    const rpc = await chain();
    const receipt = await rpc.getTransactionReceipt(tx.hash);
    const confirmations = receipt ? await receipt.confirmations() : 0;
    if (tx.confirmations !== confirmations) {
      tx.confirmations = confirmations;
      save(record);
    }
    if (!receipt || confirmations < 2) return;
    const expectedEvent = tx.action === "issue" ? "VoucherIssued" : "VoucherRedeemed";
    const matched = receipt.logs.some(log => {
      if (log.address.toLowerCase() !== tx.contract.toLowerCase()) return false;
      const event = contractInterface.parseLog(log);
      return event?.name === expectedEvent && event.args[0] === id("waterwise:" + record.id) &&
        event.args[1] === BigInt(record.approved!);
    });
    tx.status = receipt.status === 1 && matched ? "confirmed" : "failed";
    save(record);
  } catch {
    // RPC errors leave a signed transaction pending so it can be retried safely.
  }
}

async function broadcast(tx: Attempt, retry = false) {
  if (Boolean(tx.local) !== localTest()) return;
  try {
    const rpc = await chain();
    if (retry && await rpc.getTransaction(tx.hash)) return;
    await rpc.broadcastTransaction(tx.signed);
  } catch {
    // The node may have accepted the transaction even if the request failed.
    // Keep its hash and rebroadcast the same signed bytes on retry.
  }
}

router.get("/requests", async (request, response) => {
  const staff = role(request.get("authorization"));
  const owner = request.get("x-waterwise-farmer");
  if (request.query.role && request.query.role !== staff) {
    response.status(403).json({ error: "Enter the access code for this demo staff role." });
    return;
  }
  if (!staff && (!owner || !uuid.test(owner))) {
    response.status(401).json({ error: "Enter valid demo staff credentials or use the farmer screen." });
    return;
  }
  const records = await serialize(async () => {
    const records = list(staff ? undefined : owner?.toLowerCase());
    await Promise.all(records.map(refresh));
    return records.map(publicRecord);
  });
  response.json(records);
});

router.post("/requests", (request, response) => {
  const farmer = request.get("x-waterwise-farmer");
  const { requestId, available, scenario, beds } = request.body ?? {};
  if (!farmer || !uuid.test(farmer) || typeof requestId !== "string" || !uuid.test(requestId) ||
      !validLitres(available) || (scenario !== "dry" && scenario !== "rainy") ||
      !Array.isArray(beds) || beds.length > 100 || beds.some(bed =>
        !bed || typeof bed.crop !== "string" || !Object.hasOwn(demoData.factors, bed.crop) ||
        !stages.includes(bed.stage) || !validLitres(bed.area) || bed.area === 0)) {
    response.status(400).json({ error: "Use a valid demo farm and enter the litres available today." });
    return;
  }
  const requestKey = requestId.toLowerCase();
  const owner = farmer.toLowerCase();
  const existing = find(requestKey);
  if (existing) {
    if (existing.owner !== owner) {
      response.status(409).json({ error: "That request ID is already in use." });
      return;
    }
    response.json(publicRecord(existing));
    return;
  }
  const weather = demoData.weather[scenario as keyof typeof demoData.weather];
  const needed = beds.reduce((total, bed) => {
    const factor = demoData.factors[bed.crop as keyof typeof demoData.factors][stages.indexOf(bed.stage)]!;
    return total + Math.max(0, weather.loss * factor - weather.rain) * bed.area;
  }, 0) as number;
  const shortfall = Math.max(0, needed - available);
  if (!validLitres(needed) || shortfall === 0) {
    response.status(400).json({ error: "A water request needs a positive shortfall." });
    return;
  }
  const record: WaterRequest = { id: requestKey, owner, available, needed, shortfall, created: new Date().toISOString(), attempts: [] };
  save(record);
  response.status(201).json(publicRecord(record));
});

router.post("/requests/:id/replay", async (request, response) => {
  if (role(request.get("authorization")) !== "replay") {
    response.status(403).json({ error: "Use the Collection Point B access code." });
    return;
  }
  const record = find(request.params.id);
  const last = record?.attempts.at(-1);
  if (!record || last?.action !== "redeem" || last.status !== "confirmed" || Boolean(last.local) !== localTest()) {
    response.status(409).json({ error: "Wait for confirmed redemption before checking repeat use." });
    return;
  }
  try {
    const contract = new Contract(last.contract, abi, await chain());
    const second = await contract.getFunction("secondRedeemer").staticCall();
    try {
      await contract.getFunction("redeem").staticCall(id("waterwise:" + record.id), { from: second });
    } catch (error) {
      if (isError(error, "CALL_EXCEPTION") && error.revert?.name === "VoucherNotIssued") {
        response.json({ message: "Collection Point B was blocked by the contract. This read-only simulation sent no transaction." });
        return;
      }
      throw error;
    }
    response.status(409).json({ error: "The contract did not block the replay simulation." });
  } catch {
    response.status(503).json({ error: "Could not verify the replay on the configured contract. Try again." });
  }
});

router.post("/requests/:id/:action", async (request, response) => {
  const action = request.params.action;
  if ((action !== "issue" && action !== "redeem") || role(request.get("authorization")) !== action) {
    response.status(403).json({ error: "This action requires the corresponding demo staff role." });
    return;
  }

  await serialize(async () => {
    const record = find(request.params.id);
    if (!record) {
      response.status(404).json({ error: "Water request not found." });
      return;
    }
    await refresh(record);
    const last = record.attempts.at(-1);
    const issued = record.attempts.some(tx => tx.action === "issue" && tx.status === "confirmed");
    const redeemed = last?.action === "redeem" && last.status === "confirmed";
    if (redeemed || (action === "issue" && issued)) {
      response.json(publicRecord(record));
      return;
    }
    if (last?.status === "pending") {
      if (last.action === action) await broadcast(last, true);
      response.status(202).json(publicRecord(record));
      return;
    }
    if (action === "redeem" && !issued) {
      response.status(409).json({ error: "Wait for confirmed issuance before redeeming." });
      return;
    }
    if (action === "redeem" && request.body?.handedOver !== true) {
      response.status(400).json({ error: "Confirm that the approved water was handed over." });
      return;
    }
    if (action === "issue" && record.approved === undefined) {
      const { approved, checkedSupply } = request.body ?? {};
      if (!Number.isSafeInteger(approved) || approved <= 0 || approved > Math.ceil(record.shortfall) ||
          !validLitres(checkedSupply) || approved > checkedSupply) {
        response.status(400).json({ error: "Approve whole litres within the rounded-up shortfall and the supply you checked." });
        return;
      }
      record.approved = approved;
      record.checkedSupply = checkedSupply;
      save(record);
    }

    const blocking = list().filter(other => other.id !== record.id && other.attempts.at(-1)?.action === action &&
      other.attempts.at(-1)?.status === "pending");
    await Promise.all(blocking.map(refresh));
    if (blocking.some(other => other.attempts.at(-1)?.status === "pending")) {
      response.status(409).json({ error: "This staff wallet has a pending transaction. Confirm or retry it first." });
      return;
    }

    let tx: Attempt;
    try {
      const address = getAddress(process.env.FUJI_VOUCHER_ADDRESS || "");
      const key = action === "issue" ? process.env.FUJI_ISSUER_PRIVATE_KEY : process.env.FUJI_REDEEMER_PRIVATE_KEY;
      if (!key || (record.contract && record.contract !== address) || (last && Boolean(last.local) !== localTest())) {
        throw new Error("Missing wallet or contract mismatch");
      }
      const rpc = await chain();
      const wallet = new Wallet(key, rpc);
      const contract = new Contract(address, abi, rpc);
      const staff = await contract.getFunction(action === "issue" ? "issuer" : "redeemer").staticCall();
      if (staff !== wallet.address) throw new Error("Wallet has the wrong contract role");
      const voucherId = id("waterwise:" + record.id);
      const args = action === "issue" ? [voucherId, record.approved!] : [voucherId];
      const prepared = await wallet.populateTransaction({
        to: address, data: contractInterface.encodeFunctionData(action, args),
      });
      const feePerGas = prepared.maxFeePerGas ?? prepared.gasPrice;
      if (prepared.gasLimit == null || feePerGas == null ||
          await rpc.getBalance(wallet.address) < BigInt(prepared.gasLimit) * BigInt(feePerGas)) {
        throw new Error("Insufficient fee balance");
      }
      const signed = await wallet.signTransaction(prepared);
      tx = { action, hash: keccak256(signed), signed, contract: address, status: "pending",
        confirmations: 0, local: localTest() };
    } catch {
      record.error = action;
      save(record);
      response.status(503).json({ error: "Transaction could not be prepared. Check the Fuji contract, role wallet, test AVAX and RPC, then retry." });
      return;
    }

    record.contract = tx.contract;
    record.attempts.push(tx);
    delete record.error;
    save(record);
    await broadcast(tx);
    response.status(202).json(publicRecord(record));
  });
});

export default router;
