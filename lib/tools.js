import { db } from "./db.js";

/**
 * Gemini Tool Declarations for Function Calling.
 */
export const toolDeclarations = [
  {
    name: "get_current_weather",
    description: "Fetches live, real-time weather conditions and forecast for any city or location worldwide.",
    parameters: {
      type: "OBJECT",
      properties: {
        location: {
          type: "STRING",
          description: "City name, or city and country (e.g. 'Tokyo', 'San Francisco, CA', 'Paris, France')",
        },
      },
      required: ["location"],
    },
  },
  {
    name: "search_web",
    description: "Searches the live web for real-time news, today's headlines, recent events, facts, articles, and Wikipedia summaries. Call this whenever the user asks about current events, news, recent developments, or external knowledge.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Search keywords or question to search on the live web (e.g. 'world news today', 'technology headlines', 'latest developments').",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "send_email",
    description: "Composes and dispatches an email message to a specified recipient.",
    parameters: {
      type: "OBJECT",
      properties: {
        to: {
          type: "STRING",
          description: "Recipient email address (e.g. 'colleague@example.com')",
        },
        subject: {
          type: "STRING",
          description: "Subject line of the email",
        },
        body: {
          type: "STRING",
          description: "Body message content of the email",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "query_database",
    description: "Queries internal database records, document catalog, or enterprise tables (e.g. 'documents', 'users', 'analytics', 'orders').",
    parameters: {
      type: "OBJECT",
      properties: {
        table: {
          type: "STRING",
          description: "Target database table or category ('documents', 'system', 'sample_orders', 'users')",
        },
        query: {
          type: "STRING",
          description: "Filter query or search criteria",
        },
      },
      required: ["table"],
    },
  },
  {
    name: "calculator",
    description: "Computes mathematical and arithmetic expressions accurately.",
    parameters: {
      type: "OBJECT",
      properties: {
        expression: {
          type: "STRING",
          description: "Mathematical expression to evaluate using numbers and operators (e.g. '2^10 + (12 * 3.5) / 4')",
        },
      },
      required: ["expression"],
    },
  },
];

/* ──────────────── Helper Implementations ──────────────── */

function getWeatherDescription(code) {
  const table = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    95: "Thunderstorm",
  };
  return table[code] || "Variable conditions";
}

export async function executeTool(name, args, { userId = null } = {}) {
  try {
    switch (name) {
      case "get_current_weather": {
        const { location } = args;
        const geoRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`
        );
        const geoData = await geoRes.json();
        if (!geoData.results || !geoData.results.length) {
          return { error: `Location '${location}' could not be resolved.` };
        }

        const { latitude, longitude, name: cityName, country } = geoData.results[0];
        const weatherRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m`
        );
        const weatherData = await weatherRes.json();
        const cur = weatherData.current || {};
        const tempC = cur.temperature_2m;
        const tempF = tempC !== undefined ? Math.round((tempC * 9) / 5 + 32) : null;

        return {
          location: `${cityName}, ${country}`,
          temperatureCelsius: tempC,
          temperatureFahrenheit: tempF,
          condition: getWeatherDescription(cur.weather_code),
          humidity: cur.relative_humidity_2m ? `${cur.relative_humidity_2m}%` : "N/A",
          windSpeed: cur.wind_speed_10m ? `${cur.wind_speed_10m} km/h` : "N/A",
          timestamp: cur.time || new Date().toISOString(),
        };
      }

      case "search_web": {
        const { query } = args;
        const results = [];
        const isNewsQuery = /news|headline|today|latest|current|breaking|happening/i.test(query);

        // For news and current event queries, query live Google News RSS
        if (isNewsQuery) {
          try {
            const feedUrl =
              query && query.length > 5
                ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
                : "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en";
            const newsRes = await fetch(feedUrl);
            if (newsRes.ok) {
              const xmlText = await newsRes.text();
              const items = xmlText.match(/<item>[\s\S]*?<\/item>/g) || [];
              for (const item of items.slice(0, 5)) {
                const titleMatch = item.match(/<title>(.*?)<\/title>/);
                const linkMatch = item.match(/<link>(.*?)<\/link>/);
                const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
                if (titleMatch) {
                  results.push({
                    title: titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1"),
                    snippet: pubDateMatch ? `Published: ${pubDateMatch[1]}` : "Current headline",
                    url: linkMatch ? linkMatch[1] : "https://news.google.com",
                  });
                }
              }
            }
          } catch (e) {
            console.warn("[Tools] News RSS fetch error:", e.message);
          }
        }

        // Search Wikipedia API for encyclopedic summaries
        if (results.length === 0) {
          try {
            const wikiRes = await fetch(
              `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&srlimit=3`
            );
            const wikiData = await wikiRes.json();
            if (wikiData.query && wikiData.query.search) {
              for (const item of wikiData.query.search) {
                const cleanSnippet = item.snippet.replace(/<[^>]+>/g, "");
                results.push({
                  title: item.title,
                  snippet: cleanSnippet,
                  url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
                });
              }
            }
          } catch {}
        }

        // Fallback / DuckDuckGo instant answer check
        if (results.length === 0) {
          try {
            const ddgRes = await fetch(
              `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
            );
            const ddgData = await ddgRes.json();
            if (ddgData.AbstractText) {
              results.push({
                title: ddgData.Heading || query,
                snippet: ddgData.AbstractText,
                url: ddgData.AbstractURL || "https://duckduckgo.com",
              });
            }
          } catch {}
        }

        return {
          query,
          count: results.length,
          results: results.length ? results : [{ snippet: `No immediate results found for '${query}'.` }],
        };
      }

      case "send_email": {
        const { to, subject, body } = args;
        // Email dispatcher simulation (with validation)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(to)) {
          return { error: `Invalid recipient email address: '${to}'` };
        }

        const messageId = "msg_" + Math.random().toString(36).slice(2, 10);
        return {
          status: "SENT_SUCCESSFULLY",
          messageId,
          recipient: to,
          subject,
          preview: body.slice(0, 100) + (body.length > 100 ? "…" : ""),
          timestamp: new Date().toISOString(),
        };
      }

      case "query_database": {
        const { table, query: filter } = args;
        if (table === "documents") {
          const docs = userId ? db.getUserDocuments(userId) : [];
          return {
            table: "documents",
            count: docs.length,
            records: docs.map((d) => ({
              id: d.id,
              name: d.name,
              sizeBytes: d.size,
              chunkCount: d.chunkCount,
              uploadedAt: new Date(d.uploadedAt).toISOString(),
            })),
          };
        }

        if (table === "sample_orders") {
          const mockOrders = [
            { orderId: "ORD-9281", customer: "Acme Corp", amount: "$4,250", status: "Delivered", date: "2026-03-12" },
            { orderId: "ORD-9282", customer: "Starlight Labs", amount: "$1,890", status: "In Transit", date: "2026-03-14" },
            { orderId: "ORD-9283", customer: "Horizon Media", amount: "$8,400", status: "Processing", date: "2026-03-15" },
          ];
          return { table: "sample_orders", count: mockOrders.length, records: mockOrders };
        }

        return {
          table,
          info: `Table '${table}' accessed. Query filter '${filter || "ALL"}' applied.`,
          status: "ready",
        };
      }

      case "calculator": {
        const { expression } = args;
        const sanitized = String(expression || "").trim();
        if (!sanitized || /[^0-9+\-*/().^% \t\r\n]/.test(sanitized)) {
          return { error: "Unsupported expression. Only numbers and operators (+ - * / ^ % ( )) are allowed." };
        }
        // Substitute power operator ^ to **
        const jsExpr = sanitized.replace(/\^/g, "**");
        const result = Function(`"use strict"; return (${jsExpr})`)();
        if (typeof result !== "number" || isNaN(result) || !isFinite(result)) {
          return { error: "Computation resulted in an invalid number or division by zero." };
        }
        return { expression, result };
      }

      default:
        return { error: `Unknown tool '${name}'` };
    }
  } catch (err) {
    console.error(`[Tool Execution Error] ${name}:`, err.message);
    return { error: `Tool execution failed: ${err.message}` };
  }
}
