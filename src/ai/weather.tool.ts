import type { JarvisTool } from "./tools.js";

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 10_000;

interface GeoResult {
  name?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

interface Forecast {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    weather_code?: number[];
  };
}

/** Descripción corta en español de los códigos WMO de Open-Meteo. */
function describeCode(code: number | undefined): string {
  const table: Array<[string, string]> = [
    ["0", "despejado"],
    ["1", "mayormente despejado"],
    ["2", "parcialmente nublado"],
    ["3", "nublado"],
    ["45", "niebla"],
    ["48", "niebla con escarcha"],
    ["51", "llovizna leve"],
    ["53", "llovizna"],
    ["55", "llovizna intensa"],
    ["56", "llovizna helada"],
    ["57", "llovizna helada intensa"],
    ["61", "lluvia leve"],
    ["63", "lluvia"],
    ["65", "lluvia fuerte"],
    ["66", "lluvia helada"],
    ["67", "lluvia helada fuerte"],
    ["71", "nevada leve"],
    ["73", "nevada"],
    ["75", "nevada fuerte"],
    ["77", "granizo fino"],
    ["80", "chubascos leves"],
    ["81", "chubascos"],
    ["82", "chubascos fuertes"],
    ["85", "chubascos de nieve"],
    ["86", "chubascos de nieve fuertes"],
    ["95", "tormenta eléctrica"],
    ["96", "tormenta con granizo"],
    ["99", "tormenta fuerte con granizo"],
  ];

  const hit = table.find(([key]) => Number(key) === code);
  return hit ? hit[1] : "sin datos";
}

async function geocode(
  city: string,
): Promise<{ name: string; latitude: number; longitude: number }> {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=1&language=es&format=json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`geocoding falló: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { results?: GeoResult[] };
  const hit = data.results?.[0];
  if (!hit?.latitude || !hit?.longitude) {
    throw new Error(`no encontré la ciudad "${city}"`);
  }

  return {
    name: [hit.name, hit.country].filter(Boolean).join(", "),
    latitude: hit.latitude,
    longitude: hit.longitude,
  };
}

async function fetchForecast(
  latitude: number,
  longitude: number,
): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    forecast_days: "2",
    timezone: "auto",
  });

  const response = await fetch(`${FORECAST_URL}?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`forecast falló: HTTP ${response.status}`);
  }

  return (await response.json()) as Forecast;
}

export function createWeatherTool(defaultLocation: string): JarvisTool {
  return {
    name: "get_weather",

    description:
      "Consulta el clima actual y el pronóstico de las próximas 24 h para una ciudad. " +
      "Usala SIEMPRE que Fran pregunte por el clima: no lo adivinás.",

    parameters: {
      type: "object",

      properties: {
        city: {
          type: "string",
          description:
            "Ciudad a consultar. Opcional: sin valor se usa la ciudad de Fran.",
        },
      },

      required: [],
    },

    async execute(args): Promise<string> {
      const city = args.city?.trim() || defaultLocation;

      try {
        const place = await geocode(city);
        const forecast = await fetchForecast(place.latitude, place.longitude);

        const current = forecast.current;
        if (!current) {
          return `No pude obtener el clima actual de ${place.name}.`;
        }

        const now = `${Math.round(current.temperature_2m ?? 0)}° (sensación ${Math.round(
          current.apparent_temperature ?? 0,
        )}°), ${describeCode(current.weather_code)}, viento ${Math.round(
          current.wind_speed_10m ?? 0,
        )} km/h, humedad ${Math.round(current.relative_humidity_2m ?? 0)}%`;

        const daily = forecast.daily;
        const todayLine =
          daily?.time?.[0] !== undefined
            ? ` Hoy: ${Math.round(daily.temperature_2m_max?.[0] ?? 0)}° / ${Math.round(
                daily.temperature_2m_min?.[0] ?? 0,
              )}°, lluvia ${daily.precipitation_probability_max?.[0] ?? 0}% (${describeCode(
                daily.weather_code?.[0],
              )}).`
            : "";

        const tomorrowLine =
          daily?.time?.[1] !== undefined
            ? ` Mañana: ${Math.round(daily.temperature_2m_max?.[1] ?? 0)}° / ${Math.round(
                daily.temperature_2m_min?.[1] ?? 0,
              )}°, lluvia ${daily.precipitation_probability_max?.[1] ?? 0}%.`
            : "";

        return `Clima en ${place.name}: ${now}.${todayLine}${tomorrowLine}`;
      } catch (error) {
        console.warn("⚠️  Error consultando el clima:", error);
        return `No pude consultar el clima de "${city}" ahora mismo. No inventes datos: decíle a Fran que el servicio no respondió.`;
      }
    },
  };
}
