This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## WaterWise backend

Start the API in `Drought_Defender/backend` with `npm ci` and `npm run dev`.
In a second terminal, start Next.js in `Drought_Defender/frontend` with
`npm ci` and `npm run dev`.

Next.js forwards `/api/waterwise/demo` to the backend on port 4000. Set
`WATERWISE_BACKEND_URL` in the frontend environment before starting or building
if the API runs at a different address.

The endpoint provides the sample weather and crop factors. The frontend uses
bundled sample data when the API is unavailable. Farm settings and crop beds
stay in browser storage.

## Ask WaterWise

Copy `backend/.env.example` to `backend/.env` if it does not already exist,
then set `GROQ_API_KEY` and restart the backend. Open **Ask WaterWise** to ask
about your demo watering plan or try the provider tools.

The agent calculates the dry and rainy plans from the submitted beds. Its
Avalanche tool reads the latest Fuji C-Chain block by default, and its Binance
tool reads the public AVAX/USDT spot price without exchange credentials.

To enable tracing, set `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY`.
LangSmith receives the run timing, model, request count, tool names, and
outcome. Groq receives the question and receives the crop-bed estimates when
the model requests the watering-plan tool.

## BACISS water vouchers

Use Node.js 22.13 or later. In the backend folder, run `npm ci` and
`npm test` to compile Solidity and exercise the contract and API on a local
test chain. Run `npm run dev` in each app to start the demo.

1. On **Watering Plan**, enter the litres available today and submit a request
   if there is a shortfall. Follow its status in **My Voucher**. The backend
   recalculates the shortfall from the demo crop beds and weather scenario.
2. Switch to **Cooperative staff** and enter the demo issuer access code.
   Check the supply, enter the litres available, and approve a whole-litre
   amount. The maximum is the lesser of the confirmed supply and the shortfall
   rounded up to the nearest litre. The approval stays fixed across retries.
3. Wait for **Ready to collect**. Switch to **Collection Point A** and enter
   its demo code. Confirm the handover and redeem the voucher.
4. After **Used** appears, switch to **Collection Point B** and choose
   **Simulate repeat redemption**. The backend asks the contract to execute a
   read-only call from B's authorised address and verifies its rejection.

The API shows issuance or redemption after a successful receipt with the
matching contract event and two confirmations. Use the retry button after a
failed or interrupted submission. A pending retry resends the existing signed
transaction, while a confirmed failure can submit a new transaction for the
same voucher ID. Run one backend instance with a persistent SQLite volume,
and use dedicated role wallets while the demo runs. Keep the SQLite file and
its WAL on the same volume across restarts.

### Deploy to Avalanche Fuji

Use funded demo wallets for the deployer, issuer and Collection Point A.
Collection Point B needs a distinct public address for the read-only replay
check. The three staff addresses must be distinct. Fuji C-Chain uses chain ID
`43113`. Store keys in the backend environment or its ignored `.env` file.

| Variable | Purpose |
| --- | --- |
| `FUJI_RPC_URL` | Fuji C-Chain RPC. Defaults to `https://api.avax-test.network/ext/bc/C/rpc`. |
| `FUJI_DEPLOYER_PRIVATE_KEY` | Funded test wallet for deployment only. |
| `FUJI_ISSUER_ADDRESS` | Public address of the cooperative's test wallet. |
| `FUJI_REDEEMER_ADDRESS` | Public address of Collection Point A's test wallet. |
| `FUJI_SECOND_REDEEMER_ADDRESS` | Public address of Collection Point B, authorised in the contract. |
| `FUJI_VOUCHER_ADDRESS` | Verified contract address printed by the deployment script. |
| `FUJI_ISSUER_PRIVATE_KEY` | Funded test key matching the on-chain issuer role. |
| `FUJI_REDEEMER_PRIVATE_KEY` | Funded test key matching the on-chain redeemer role. |
| `VOUCHER_ISSUER_CODE`, `VOUCHER_REDEEMER_CODE`, `VOUCHER_SECOND_REDEEMER_CODE` | Distinct demo staff access codes configured on the backend. |
| `VOUCHER_DB_PATH` | SQLite database path. Defaults to `data/vouchers.sqlite` relative to the backend. |
| `VOUCHER_LOCAL_TEST` | Leave false for Fuji. Local tests set true and use a loopback RPC and separate database. |

From the backend folder, run `npm run voucher:deploy` with the deployment
variables set. The script checks the network and deployer balance, then prints
the contract address and explorer link after verifying the receipt, bytecode,
and role addresses. If it prints a deployment transaction hash and later times
out, check that transaction before deploying again. Set
`FUJI_VOUCHER_ADDRESS`, configure the runtime variables, and restart the API.

**Verified Fuji contract address and explorer link:** Pending deployment.
The two-collection-point workflow and rejected replay have been exercised on a
local EVM test chain. Use the deployment script's output to fill in the verified
address and explorer link. The earlier single-redeemer contract cannot perform
the Collection Point B demo.

### Seven-minute BACISS run-of-show

| Time | Demo |
| --- | --- |
| 0:00–1:00 | Open Watering Plan and choose **Load BACISS mock farm**. Show the dry-spell alert in **Alerts**, then open the plan from the alert. |
| 1:00–2:00 | Show 70 L estimated need, 30 L available, and a 40 L shortfall. The dry mock beds use growing tomatoes at 20/3 m² (46 L) and mature spinach at 4 m² (24 L). Submit the request and show **Pending approval**. |
| 2:00–3:30 | Switch to **Cooperative staff**, check 45 L in mock supply, and issue 40 L. Wait for **Ready to collect** and open the confirmed issuance transaction. |
| 3:30–5:00 | Switch to **Collection Point A**, confirm handover, redeem, and show **Used**. Open the confirmed redemption transaction. |
| 5:00–6:15 | Switch to **Collection Point B** and simulate the same redemption. Show the contract's rejection. This read-only simulation is separate from the two successful state-changing transactions and produces no transaction hash. |
| 6:15–7:00 | Recap that the farm, supply, and identities are mock data and no personal details go on-chain. If Fuji is unavailable, label the local test results as local and omit live transaction claims. |

Only opaque voucher IDs, approved litres, transaction data, and staff wallet
addresses appear on-chain. Farmer identities and farm records stay off-chain.
WaterWise is free for farmers. A six-month cooperative subscription via
Binance Pay is a proposed revenue feature.

Open **Payments** to try the six-month cooperative checkout at the sample
price of R600. Avalanche Fuji and Binance Pay are simulated. The browser
saves a mock confirmation and no funds move.

### Water source dashboard

On **Watering Plan**, choose **Tank** or **Borehole**. The litres available
for the selected source feed the existing shortfall calculation. Log actual
litres used on any date through today to see the average per logged day.
Log zero for a day with no usage. Tank and borehole have separate readings,
saved in the browser alongside the farm setup.
