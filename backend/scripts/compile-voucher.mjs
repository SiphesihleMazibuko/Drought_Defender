import { readFileSync } from "node:fs";
import solc from "solc";

export function compileVoucher() {
  const source = readFileSync(new URL("../contracts/WaterVoucher.sol", import.meta.url), "utf8");
  const result = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: { "WaterVoucher.sol": { content: source } },
    settings: { evmVersion: "shanghai", optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  })));
  const errors = result.errors?.filter(item => item.severity === "error") ?? [];
  if (errors.length) throw new Error(errors.map(item => item.formattedMessage).join("\n"));
  const { abi, evm } = result.contracts["WaterVoucher.sol"].WaterVoucher;
  return { abi, bytecode: "0x" + evm.bytecode.object };
}
