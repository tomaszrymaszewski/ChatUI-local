export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
}

const timeTool: ToolDefinition = {
  type: "function",
  function: {
    name: "get_current_time",
    description: "Get the current time. Use when the user asks about the current time.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "Optional IANA timezone (e.g. 'America/New_York'). Defaults to user's local timezone.",
        },
      },
      required: [],
    },
  },
};

const dateTool: ToolDefinition = {
  type: "function",
  function: {
    name: "get_current_date",
    description: "Get the current date. Use when the user asks about today's date, what day it is, etc.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "Optional IANA timezone (e.g. 'America/New_York'). Defaults to user's local timezone.",
        },
      },
      required: [],
    },
  },
};

const weatherTool: ToolDefinition = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get current weather for a location using the Open-Meteo API. Use when the user asks about weather, temperature, forecast, rain, wind, etc.",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "City name or location (e.g. 'London', 'New York', 'Tokyo').",
        },
      },
      required: ["location"],
    },
  },
};

const webFetchTool: ToolDefinition = {
  type: "function",
  function: {
    name: "web_fetch",
    description: "Fetch the content of a web page and return it as text. Use when the user asks you to read a URL or look something up online.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch.",
        },
      },
      required: ["url"],
    },
  },
};

export const ALWAYS_ON_TOOLS: ToolDefinition[] = [timeTool, dateTool, weatherTool];
export const TOGGLEABLE_TOOLS: ToolDefinition[] = [webFetchTool];

export function getAllTools(webFetchEnabled: boolean): ToolDefinition[] {
  return [...ALWAYS_ON_TOOLS, ...(webFetchEnabled ? TOGGLEABLE_TOOLS : [])];
}

async function executeGetCurrentTime(args: Record<string, unknown>): Promise<string> {
  const timezone = args.timezone as string | undefined;
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: timezone || undefined,
  });
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `Current time: ${time} (${tz})`;
}

async function executeGetCurrentDate(args: Record<string, unknown>): Promise<string> {
  const timezone = args.timezone as string | undefined;
  const now = new Date();
  const date = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: timezone || undefined,
  });
  return `Current date: ${date}`;
}

async function executeGetWeather(args: Record<string, unknown>): Promise<string> {
  const location = args.location as string;
  if (!location) return "Error: No location provided.";

  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
    const geoResp = await fetch(geoUrl);
    if (!geoResp.ok) return `Error: Geocoding request failed (${geoResp.status}).`;
    const geoData = await geoResp.json();
    const geoResult = geoData?.results?.[0];
    if (!geoResult) return `Error: Could not find location "${location}".`;

    const { latitude, longitude, name, country, admin1 } = geoResult;
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&temperature_unit=celsius&wind_speed_unit=kmh`;
    const weatherResp = await fetch(weatherUrl);
    if (!weatherResp.ok) return `Error: Weather request failed (${weatherResp.status}).`;
    const weatherData = await weatherResp.json();
    const c = weatherData?.current;
    if (!c) return `Error: No weather data available.`;

    const weatherDescriptions: Record<number, string> = {
      0: "Clear sky",
      1: "Mainly clear",
      2: "Partly cloudy",
      3: "Overcast",
      45: "Fog",
      48: "Depositing rime fog",
      51: "Light drizzle",
      53: "Moderate drizzle",
      55: "Dense drizzle",
      56: "Light freezing drizzle",
      57: "Dense freezing drizzle",
      61: "Slight rain",
      63: "Moderate rain",
      65: "Heavy rain",
      66: "Light freezing rain",
      67: "Heavy freezing rain",
      71: "Slight snow fall",
      73: "Moderate snow fall",
      75: "Heavy snow fall",
      77: "Snow grains",
      80: "Slight rain showers",
      81: "Moderate rain showers",
      82: "Violent rain showers",
      85: "Slight snow showers",
      86: "Heavy snow showers",
      95: "Thunderstorm",
      96: "Thunderstorm with slight hail",
      99: "Thunderstorm with heavy hail",
    };

    const desc = weatherDescriptions[c.weather_code] ?? `Weather code ${c.weather_code}`;
    const placeName = [name, admin1, country].filter(Boolean).join(", ");

    return `Weather for ${placeName}:\n` +
      `Condition: ${desc}\n` +
      `Temperature: ${c.temperature_2m}°C (feels like ${c.apparent_temperature}°C)\n` +
      `Humidity: ${c.relative_humidity_2m}%\n` +
      `Wind: ${c.wind_speed_10m} km/h\n` +
      `Precipitation: ${c.precipitation} mm`;
  } catch (err) {
    return `Error: Failed to fetch weather - ${err instanceof Error ? err.message : "unknown error"}`;
  }
}

async function executeWebFetch(args: Record<string, unknown>): Promise<string> {
  const url = args.url as string;
  if (!url) return "Error: No URL provided.";

  try {
    const resp = await fetch(url, {
      headers: { Accept: "text/html, text/plain" },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return `Error: Fetch failed (${resp.status} ${resp.statusText}).`;

    const contentType = resp.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      const html = await resp.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<footer[\s\S]*?<\/footer>/gi, "")
        .replace(/<header[\s\S]*?<\/header>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
      return text.slice(0, 8000);
    }

    const text = await resp.text();
    return text.slice(0, 8000);
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return "Error: Request timed out.";
    }
    return `Error: Failed to fetch URL - ${err instanceof Error ? err.message : "unknown error"}`;
  }
}

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments);
  } catch {
    // empty args is fine for some tools
  }

  let content: string;
  switch (call.name) {
    case "get_current_time":
      content = await executeGetCurrentTime(args);
      break;
    case "get_current_date":
      content = await executeGetCurrentDate(args);
      break;
    case "get_weather":
      content = await executeGetWeather(args);
      break;
    case "web_fetch":
      content = await executeWebFetch(args);
      break;
    default:
      content = `Error: Unknown tool "${call.name}".`;
  }

  return { tool_call_id: call.id, content };
}
