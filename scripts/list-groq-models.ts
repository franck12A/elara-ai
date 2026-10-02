import "dotenv/config";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const list = await groq.models.list();

for (const model of list.data) {
  console.log(model.id);
}
