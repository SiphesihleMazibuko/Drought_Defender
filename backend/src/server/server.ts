import "dotenv/config";
import express from "express";
import routes from "../routes/routes.js";
import vouchers from "../vouchers.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use("/api/waterwise", express.json({ limit: "32kb" }), routes);
app.use("/api/waterwise", vouchers);
app.listen(port, () => {
  console.log(`WaterWise API listening on port ${port}`);
});
