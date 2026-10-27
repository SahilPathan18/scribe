import { GoogleGenerativeAI } from "@google/generative-ai";
import { PDFParse } from "pdf-parse";
import { db } from "./db.js";
import { chunkText, VectorStore } from "./vectorStore.js";

const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";

/**
 * Generate embedding for a single string using Gemini.
 */
export async function getEmbedding(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Text is required for embedding generation.");
  }
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent({
    content: { parts: [{ text: text.slice(0, 4000) }] },
  });
  return result.embedding.values;
}

/**
 * Parses uploaded document buffer into text.
 */
export async function extractTextFromBuffer(buffer, originalname, mimetype) {
  const isPdf =
    mimetype === "application/pdf" ||
    (originalname && originalname.toLowerCase().endsWith(".pdf"));

  if (isPdf) {
    const parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    return (textResult.text || "").trim();
  }

  // Treat as plain text / markdown / code
  return buffer.toString("utf-8").trim();
}

/**
 * Processes and indexes an uploaded document into the RAG vector store.
 */
const MAX_CHUNKS_PER_DOC = 100;

export async function processAndIndexDocument({ buffer, originalname, mimetype, userId }) {
  const fullText = await extractTextFromBuffer(buffer, originalname, mimetype);
  if (!fullText || fullText.length < 20) {
    throw new Error("Document is empty or contains no readable text.");
  }

  const docId = "doc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  const chunks = chunkText(fullText, 750, 120);

  if (!chunks.length) {
    throw new Error("No readable text chunks could be extracted from document.");
  }

  if (chunks.length > MAX_CHUNKS_PER_DOC) {
    throw new Error(
      `Document exceeds the maximum limit of ${MAX_CHUNKS_PER_DOC} text chunks (extracted ${chunks.length} chunks). Please upload a smaller document.`
    );
  }

  // Generate embeddings for chunks — fail fast if any chunk fails to maintain consistency
  const embeddings = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const emb = await getEmbedding(chunks[i]);
      embeddings.push(emb);
    } catch (err) {
      console.error(`[RAG] Error embedding chunk ${i + 1}/${chunks.length}:`, err.message);
      throw new Error(`Embedding generation failed at chunk ${i + 1} of ${chunks.length}: ${err.message}`);
    }
  }

  // Prepare document metadata
  const docRecord = {
    id: docId,
    name: originalname || "Document",
    size: buffer.length,
    mimeType: mimetype || "application/octet-stream",
    chunkCount: chunks.length,
    userId: userId || "public",
    uploadedAt: Date.now(),
  };

  // Store in vector store before recording document
  await VectorStore.addDocumentChunks({
    docId,
    docName: docRecord.name,
    userId: docRecord.userId,
    chunks,
    embeddings,
  });

  // Save document metadata once vectors have been written
  db.saveDocument(docRecord);

  return docRecord;
}

/**
 * Queries the vector store for grounded context given a user query.
 */
export async function retrieveGroundedContext(query, { userId = null, topK = 4 } = {}) {
  try {
    const queryVector = await getEmbedding(query);
    const matches = VectorStore.searchSimilar(queryVector, { userId, topK, minSimilarity: 0.35 });

    if (!matches || !matches.length) {
      return { contextText: "", citations: [] };
    }

    const citations = matches.map((m) => ({
      docId: m.docId,
      docName: m.docName,
      chunkIndex: m.chunkIndex + 1,
      totalChunks: m.totalChunks,
      similarity: m.similarity,
      preview: m.text.slice(0, 160) + (m.text.length > 160 ? "…" : ""),
    }));

    const formattedPassages = matches
      .map(
        (m, i) =>
          `[Source ${i + 1} - ${m.docName} (Part ${m.chunkIndex + 1}/${m.totalChunks})]:\n${m.text}`
      )
      .join("\n\n---\n\n");

    const contextText = `\n\n════════════ GROUNDED KNOWLEDGE BASE CONTEXT ════════════\n` +
      `The following excerpts are retrieved directly from uploaded documents:\n\n` +
      `${formattedPassages}\n` +
      `══════════════════════════════════════════════════════════\n` +
      `Instructions for RAG: Use the excerpts above to answer the user's question accurately. ` +
      `If the documents contain the answer, cite the source name in your explanation. ` +
      `If the question cannot be answered from the documents, clearly indicate what is known from the documents and what is not.\n\n`;

    return { contextText, citations };
  } catch (err) {
    console.warn("[RAG] Context retrieval error:", err.message);
    return { contextText: "", citations: [] };
  }
}
