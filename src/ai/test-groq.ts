import { validateConfig } from "../config.js";
import { GroqProvider } from "./providers/groq.provider.js";

const TEST_MESSAGE = "Respondé exactamente: INTEGRACION_GROQ_OK";
const EXPECTED_MARKER = "INTEGRACION_GROQ_OK";

async function main(): Promise<void> {
  const config = validateConfig({ requireVoice: false });

  console.log("🔗 Probando la integración con Groq...");
  console.log(`   Proveedor configurado: ${config.aiProvider}`);
  console.log(`   Modelo: ${config.groq.model}`);
  console.log(`   Timeout: ${config.groq.timeoutMs} ms`);

  try {
    const provider = new GroqProvider({
      apiKey: config.groq.apiKey ?? "",
      model: config.groq.model,
      timeoutMs: config.groq.timeoutMs,
    });

    const response = await provider.generateResponse([
      { role: "user", content: TEST_MESSAGE },
    ]);

    const text = response.text ?? "(sin texto)";

    console.log(`\n🤖 Respuesta del modelo: ${text}`);

    if (text.includes(EXPECTED_MARKER)) {
      console.log("✅ Integración con Groq funcionando correctamente.");
    } else {
      console.log(
        "⚠️  El modelo respondió, pero no incluyó el texto esperado.",
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("\n❌ Error inesperado:", error);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("❌ Error:", error);
  process.exitCode = 1;
});
