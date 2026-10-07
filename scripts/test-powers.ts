// Prueba funcional de los poderes nuevos: recordatorios, clima y validaciones
// de computer. Correrla desde un cwd temporal para no ensuciar data/.
import { ReminderService, reminderFirePrompt } from "../src/ai/reminders.js";
import {
  createSetReminderTool,
  createCancelReminderTool,
  createListRemindersTool,
} from "../src/ai/reminders.tool.js";
import { createWeatherTool } from "../src/ai/weather.tool.js";
import { createComputerTool } from "../src/ai/computer.tool.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FALLÓ: ${msg}`);
  console.log(`✓ ${msg}`);
}

async function main(): Promise<void> {
  // ── 1) Recordatorios: fire programado ──────────────────────────────
  const reminders = new ReminderService();
  await reminders.load();

  const fired: Array<{ message: string; overdueMs: number }> = [];
  reminders.start((reminder, overdueMs) => {
    fired.push({ message: reminder.message, overdueMs });
    console.log(
      `  🔥 disparó "${reminder.message}" (demorado ${Math.round(overdueMs / 1000)}s)`,
    );
  });

  const setTool = createSetReminderTool(reminders);
  const listTool = createListRemindersTool(reminders);
  const cancelTool = createCancelReminderTool(reminders);

  // inMinutes: 1 → dispara dentro del intervalo de 15s? No: 15s de check.
  // Usamos at con horario pasado cercano... mejor: agendamos con "at" ISO a +2s.
  const in2s = new Date(Date.now() + 2_000).toISOString();
  const r1 = await setTool.execute({ message: "prueba jarvis", at: in2s });
  assert(r1.includes("Recordatorio agendado"), "set_reminder agenda con ISO");
  console.log(`  → ${r1}`);

  assert(
    (await listTool.execute({})).includes("prueba jarvis"),
    "list_reminders lo muestra pendiente",
  );

  // Esperar a que dispare (check cada 15s, con primer check inmediato).
  await new Promise((resolve) => setTimeout(resolve, 17_000));
  assert(
    fired.some((f) => f.message === "prueba jarvis"),
    "el scheduler dispara el recordatorio",
  );

  // ── 2) Recordatorio vencido con el proceso apagado ─────────────────
  reminders.stop();
  const late = await setTool.execute({
    message: "prueba vencida",
    at: new Date(Date.now() - 60_000).toISOString(),
  });
  assert(
    late.includes("Ese horario ya pasó"),
    "set_reminder rechaza horarios pasados",
  );

  // Para el caso overdue inyectamos directo en el archivo y recargamos.
  const fs = await import("node:fs");
  const past = Date.now() - 90_000;
  fs.writeFileSync(
    "data/reminders.json",
    JSON.stringify({
      reminders: [
        {
          id: "testovr",
          message: "prueba overdue",
          at: past,
          createdAt: past - 1000,
          fired: false,
        },
      ],
    }),
  );
  const reminders2 = new ReminderService();
  await reminders2.load();
  const fired2: string[] = [];
  reminders2.start((reminder, overdueMs) => {
    fired2.push(reminder.id);
    console.log(
      `  🔥 overdue "${reminder.message}" demorado ${Math.round(overdueMs / 1000)}s`,
    );
    const prompt = reminderFirePrompt(reminder, overdueMs);
    assert(
      prompt.includes("demorado"),
      "el prompt de overdue menciona el retraso",
    );
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert(fired2.includes("testovr"), "el overdue dispara al arrancar");
  reminders2.stop();

  // ── 3) Cancelar por palabras ────────────────────────────────────────
  const reminders3 = new ReminderService();
  await reminders3.load();
  await reminders3.add("llamar al dentista", Date.now() + 3_600_000);
  const cancelled = await createCancelReminderTool(reminders3).execute({
    query: "dentista",
  });
  assert(
    cancelled.includes("Cancelado"),
    "cancel_reminder encuentra por palabras",
  );
  assert(
    reminders3.pending().length === 0,
    "queda sin pendientes tras cancelar",
  );

  // ── 4) Clima real (Open-Meteo, sin API key) ────────────────────────
  const weather = createWeatherTool("Buenos Aires");
  const clima = await weather.execute({});
  console.log(`  → clima: ${clima}`);
  assert(clima.startsWith("Clima en"), "get_weather responde con datos reales");
  assert(
    !clima.includes("No pude"),
    "get_weather no cayó al fallback de error",
  );

  const climaCity = await weather.execute({ city: "Madrid" });
  console.log(`  → clima Madrid: ${climaCity.slice(0, 60)}...`);
  assert(climaCity.includes("Madrid"), "get_weather geocodifica otra ciudad");

  // ── 5) Computer: solo validaciones, sin efectos reales ─────────────
  const computer = createComputerTool();
  assert(
    (await computer.execute({ action: "open" })).includes("Falta 'target'"),
    "computer exige target para open",
  );
  assert(
    (await computer.execute({ action: "open", target: "C:\\virus.exe" }))
      .includes("Por seguridad"),
    "computer rechaza rutas de archivos",
  );
  assert(
    (await computer.execute({ action: "fly" as never })).includes(
      "no reconocida",
    ),
    "computer rechaza acciones desconocidas",
  );

  console.log("\n🎯 Todos los poderes verificados.");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("\n❌ PRUEBA FALLIDA:", error);
  process.exit(1);
});
