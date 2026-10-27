import { db } from "./db.js";

/**
 * Computes cosine similarity between two float vectors.
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Splits arbitrary text into overlapping chunks with sentence awareness.
 */
export function chunkText(text, chunkSize = 750, overlap = 120) {
  if (!text || typeof text !== "string") return [];
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= chunkSize) return [clean];

  const chunks = [];
  let startIndex = 0;

  while (startIndex < clean.length) {
    let endIndex = Math.min(startIndex + chunkSize, clean.length);

    if (endIndex < clean.length) {
      // Find clean breaking point (paragraph, sentence end, or newline)
      const searchWindow = clean.slice(startIndex, Math.min(endIndex + 80, clean.length));
      const matches = [...searchWindow.matchAll(/(\.\s|\?\s|!\s|\n\n|\n)/g)];
      if (matches.length) {
        const lastValid = matches.reverse().find((m) => m.index >= chunkSize - 150);
        if (lastValid) {
          endIndex = startIndex + lastValid.index + lastValid[0].length;
        }
      }
    }

    const chunk = clean.slice(startIndex, endIndex).trim();
    if (chunk.length > 20) {
      chunks.push(chunk);
    }

    if (endIndex >= clean.length) break;
    startIndex = Math.max(endIndex - overlap, startIndex + 1);
  }

  return chunks;
}

/**
 * Vector Store Engine: Ingests documents, retrieves top-k chunks.
 */
export class VectorStore {
  /**
   * Adds text chunks and their embeddings to the vector database.
   */
  static async addDocumentChunks({ docId, docName, userId, chunks, embeddings }) {
    if (chunks.length !== embeddings.length) {
      throw new Error("Chunks and embeddings length mismatch.");
    }

    const records = chunks.map((chunk, index) => ({
      id: `emb_${docId}_${index}`,
      docId,
      docName,
      userId: userId || "public",
      chunkIndex: index,
      totalChunks: chunks.length,
      text: chunk,
      vector: embeddings[index],
      createdAt: Date.now(),
    }));

    await db.saveEmbeddings(records);
    return records.length;
  }

  /**
   * Performs semantic vector search against all indexed chunks for a user.
   */
  static async searchSimilar(queryVector, { userId = null, topK = 4, minSimilarity = 0.35 } = {}) {
    const allEmbeddings = await db.getEmbeddings(userId);
    if (!allEmbeddings || !allEmbeddings.length) return [];

    const scored = allEmbeddings
      .map((entry) => {
        const similarity = cosineSimilarity(queryVector, entry.vector);
        return {
          id: entry.id,
          docId: entry.docId,
          docName: entry.docName,
          chunkIndex: entry.chunkIndex,
          totalChunks: entry.totalChunks,
          text: entry.text,
          similarity: Math.round(similarity * 1000) / 1000,
        };
      })
      .filter((item) => item.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, topK);
  }
}
