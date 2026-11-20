import { Router } from "express";
import { runAgent } from "../agent.js";

const router = Router();

export const demoData = {
  weather: {
    dry: { loss: 6, rain: 0 },
    rainy: { loss: 4, rain: 3 },
  },
  factors: {
    Tomatoes: [0.6, 1.15, 0.9],
    Spinach: [0.55, 0.85, 1],
    Cabbage: [0.55, 0.9, 1.05],
    Maize: [0.4, 0.85, 1.2],
  },
};

router.get("/demo", (_request, response) => response.json(demoData));

router.post("/agent", async (request, response) => {
  const { question, scenario, beds } = request.body ?? {};
  if (typeof question !== "string" || !question.trim() || question.length > 600 ||
      (scenario !== "dry" && scenario !== "rainy") || !Array.isArray(beds) ||
      beds.length > 100 || beds.some((bed) => !bed || typeof bed.crop !== "string" ||
        !Object.hasOwn(demoData.factors, bed.crop) ||
        !["Seedling", "Growing", "Mature"].includes(bed.stage) ||
        !Number.isFinite(bed.area) || bed.area <= 0 ||
        !Number.isSafeInteger(bed.plants) || bed.plants <= 0)) {
    response.status(400).json({ error: "Enter a question and use a valid demo watering plan." });
    return;
  }
  if (!process.env.GROQ_API_KEY) {
    response.status(503).json({ error: "The assistant needs a Groq API key in the backend environment." });
    return;
  }

  const plans = Object.fromEntries(Object.entries(demoData.weather).map(([name, weather]) => {
    const estimates = beds.map(({ crop, stage, area, plants }) => {
      const factor = demoData.factors[crop as keyof typeof demoData.factors][["Seedling", "Growing", "Mature"].indexOf(stage)]!;
      const litres = Math.max(0, weather.loss * factor - weather.rain) * area;
      return { crop, stage, area, plants, litres, litresPerPlant: litres / plants };
    });
    return [name, { weather, totalLitres: estimates.reduce((sum, bed) => sum + bed.litres, 0), beds: estimates }];
  }));
  try {
    response.json(await runAgent(question.trim(), { activeScenario: scenario, plans }));
  } catch {
    response.status(502).json({ error: "The assistant could not get a response from Groq. Please try again." });
  }
});

export default router;
