import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { toolDeclarations, executeTool } from "./tools.js";
import { db } from "./db.js";
import { retrieveGroundedContext } from "./rag.js";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("Missing GEMINI_API_KEY in environment.");
}

const genAI = new GoogleGenerativeAI(API_KEY);
export const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const SYSTEM_INSTRUCTION =
  "You are Scribe, an articulate, thoughtful, and intellectual conversational companion. " +
  "Your answers are precise, elegant, well-structured, insightful, and concise. " +
  "Avoid patronizing filler, artificial enthusiasm, and repetitive pleasantries. " +
  "You are equipped with real-time live tools: `get_current_weather`, `search_web`, `send_email`, `query_database`, and `calculate`. " +
  "CRITICAL RULE: Never claim you cannot access real-time information, current news, live weather, or recent developments. " +
  "Whenever the user asks about today's news, current headlines, live weather, real-time facts, or recent events, YOU MUST ALWAYS invoke the `search_web` or `get_current_weather` tool before answering. " +
  "When citations or document excerpts are provided, cite the relevant sources clearly. " +
  "Prefer clean formatting with headers, blockquotes, bullet points, and syntax-highlighted code blocks.";

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

/**
 * Returns a configured GenerativeModel instance with tools and safety settings.
 */
export function getModel(modelName = MODEL_NAME) {
  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_INSTRUCTION,
    tools: [{ functionDeclarations: toolDeclarations }],
    safetySettings,
  });
}

/**
 * Summarizes conversation history to generate persistent long-term memory.
 */
export async function summarizeConversation(messages) {
  if (!messages || messages.length < 4) return null;

  try {
    const summaryModel = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: "You are an expert summarizer extracting core knowledge and user preferences.",
    });

    const transcript = messages
      .slice(-12)
      .map((m) => `${m.role.toUpperCase()}: ${m.text}`)
      .join("\n");

    const prompt =
      "Analyze the conversation transcript below and produce a concise 3-5 bullet point memory summary " +
      "capturing key topics, user preferences, specific context, and decisions made. Keep it factual and brief.\n\n" +
      transcript;

    const res = await summaryModel.generateContent(prompt);
    const summary = res.response.text();
    return summary ? summary.trim() : null;
  } catch (err) {
    console.warn("[Summarizer] Error generating context summary:", err.message);
    return null;
  }
}

/**
 * Main chat orchestrator:
 * - Injects RAG grounded context if available.
 * - Injects rolling persistent memory from past dialogue.
 * - Handles function calls (weather, search, email, database, calculator).
 * - Streams tokens and tool execution events via Server-Sent Events (SSE).
 */
export async function streamChatResponse({
  chatId,
  message,
  userId = null,
  res,
  enableRag = true,
}) {
  const model = getModel();

  // 1. Fetch chat history and persistent memory
  const chat = db.getChat(chatId) || { id: chatId, userId, title: "New Chat", summary: null };
  const historyMessages = db.getMessages(chatId);

  // 2. Check if we should update rolling memory summary
  if (historyMessages.length >= 6 && (!chat.summary || historyMessages.length % 6 === 0)) {
    summarizeConversation(historyMessages).then((newSummary) => {
      if (newSummary) {
        db.updateChatSummary(chatId, newSummary);
        chat.summary = newSummary;
        console.log(`[Memory] Updated persistent memory summary for chat ${chatId}`);
      }
    });
  }

  // 3. Ground with RAG documents if enabled
  let groundedContext = "";
  let citations = [];

  if (enableRag) {
    const ragResult = await retrieveGroundedContext(message, { userId, topK: 3 });
    if (ragResult.contextText) {
      groundedContext = ragResult.contextText;
      citations = ragResult.citations;
      // Send citations event immediately
      res.write(`data: ${JSON.stringify({ citations })}\n\n`);
    }
  }

  // 4. Build prompt content with Memory and Grounded Context
  let contextualMessage = message;
  const memoryPrefix = chat.summary
    ? `\n[Persistent Long-Term Memory from Past Sessions]:\n${chat.summary}\n\n`
    : "";

  if (memoryPrefix || groundedContext) {
    contextualMessage = `${memoryPrefix}${groundedContext}User Inquiry:\n${message}`;
  }

  // 5. Construct conversation contents for Gemini
  // Use last 10 messages for immediate turns
  const contents = [];
  const recentHistory = historyMessages.slice(-10);

  for (const m of recentHistory) {
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.text }] });
    } else if (m.role === "bot" && m.text) {
      contents.push({ role: "model", parts: [{ text: m.text }] });
    }
  }

  // Append current user message
  contents.push({ role: "user", parts: [{ text: contextualMessage }] });

  // 6. Send to Gemini and execute tools in a multi-turn reasoning loop
  let toolCallsLog = [];
  let fullResponseText = "";
  const currentContents = [...contents];
  const MAX_TOOL_TURNS = 4;
  let turn = 0;

  try {
    while (turn < MAX_TOOL_TURNS) {
      const stepResult = await model.generateContent({ contents: currentContents });
      const candidate = stepResult.response.candidates?.[0];
      const candidateParts = candidate?.content?.parts || [];
      const functionCallPart = candidateParts.find((p) => p.functionCall);

      if (functionCallPart) {
        turn++;
        const { name, args } = functionCallPart.functionCall;
        toolCallsLog.push({ name, args });

        // Notify frontend that tool execution started
        res.write(
          `data: ${JSON.stringify({
            toolStart: { name, args, message: `Executing tool ${name}…` },
          })}\n\n`
        );

        // Execute the requested tool
        const toolResult = await executeTool(name, args, { userId });

        // Notify frontend of tool result
        res.write(
          `data: ${JSON.stringify({
            toolResult: { name, result: toolResult },
          })}\n\n`
        );

        // Append candidate parts (with thoughtSignature) and user functionResponse
        currentContents.push({ role: "model", parts: candidateParts });
        currentContents.push({
          role: "user",
          parts: [{ functionResponse: { name, response: toolResult } }],
        });
      } else {
        // Model produced final text
        const text = stepResult.response.text();
        if (text) {
          fullResponseText = text;
          // Stream text in small chunks for smooth token animation
          const chunkSize = 24;
          for (let i = 0; i < text.length; i += chunkSize) {
            const slice = text.slice(i, i + chunkSize);
            res.write(`data: ${JSON.stringify({ text: slice })}\n\n`);
            await new Promise((r) => setTimeout(r, 10));
          }
        }
        break;
      }
    }

    // 7. Persist messages in database
    db.addMessage(chatId, { role: "user", text: message });
    db.addMessage(chatId, {
      role: "bot",
      text: fullResponseText,
      toolCalls: toolCallsLog.length ? toolCallsLog : null,
      citations: citations.length ? citations : null,
    });

    // Mark completion
    res.write(
      `data: ${JSON.stringify({
        done: true,
        toolCalls: toolCallsLog,
        citations,
        hasMemory: Boolean(chat.summary),
      })}\n\n`
    );
    res.end();
  } catch (err) {
    console.error("[Gemini Chat Error]:", err.message);
    const isAuthError =
      err.message?.includes("API key") || err.message?.includes("PERMISSION_DENIED");
    const errorMsg = isAuthError
      ? "Invalid or unauthorized API key. Check server configuration."
      : `Error communicating with Gemini: ${err.message}`;

    res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
    res.end();
  }
}
