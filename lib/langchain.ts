import {
  GoogleGenerativeAI,
  GenerativeModel,
  EmbedContentResponse,
} from "@google/generative-ai";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createHistoryAwareRetriever } from "langchain/chains/history_aware_retriever";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import pineconeClient from "./pinecone";
import { PineconeStore } from "@langchain/pinecone";
import { Index, RecordMetadata } from "@pinecone-database/pinecone";
import { adminDb } from "../firebaseAdmin";
import { auth } from "@clerk/nextjs/server";

// Initialize the Gemini model with API key
const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY,
  modelName: "gemini-pro", // Using Gemini Pro model
  maxOutputTokens: 2048,
});

// Initialize Google AI for embeddings
const googleAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

export const indexName = "papafam";

async function fetchMessagesFromDB(docId: string) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not found");
  }

  console.log("--- Fetching chat history from the firestore database... ---");
  // Get the last 6 messages from the chat history
  const chats = await adminDb
    .collection(`users`)
    .doc(userId)
    .collection("files")
    .doc(docId)
    .collection("chat")
    .orderBy("createdAt", "desc")
    // .limit(LIMIT)
    .get();

  const chatHistory = chats.docs.map((doc) =>
    doc.data().role === "human"
      ? new HumanMessage(doc.data().message)
      : new AIMessage(doc.data().message)
  );

  console.log(
    `--- fetched last ${chatHistory.length} messages successfully ---`
  );
  console.log(chatHistory.map((msg) => msg.content.toString()));

  return chatHistory;
}

export async function generateDocs(docId: string) {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("User not found");
  }

  console.log("--- Fetching the download URL from Firebase... ---");
  const firebaseRef = await adminDb
    .collection("users")
    .doc(userId)
    .collection("files")
    .doc(docId)
    .get();

  const downloadUrl = firebaseRef.data()?.downloadUrl;

  if (!downloadUrl) {
    throw new Error("Download URL not found");
  }

  console.log(`--- Download URL fetched successfully: ${downloadUrl} ---`);

  // Fetch the PDF from the specified URL
  const response = await fetch(downloadUrl);

  // Load the PDF into a PDFDocument object
  const data = await response.blob();

  // Load the PDF document from the specified path
  console.log("--- Loading PDF document... ---");
  const loader = new PDFLoader(data);
  const docs = await loader.load();

  // Split the loaded document into smaller parts for easier processing
  console.log("--- Splitting the document into smaller parts... ---");
  const splitter = new RecursiveCharacterTextSplitter();

  const splitDocs = await splitter.splitDocuments(docs);
  console.log(`--- Split into ${splitDocs.length} parts ---`);

  return splitDocs;
}

async function namespaceExists(
  index: Index<RecordMetadata>,
  namespace: string
) {
  if (namespace === null) throw new Error("No namespace value provided.");
  const { namespaces } = await index.describeIndexStats();
  return namespaces?.[namespace] !== undefined;
}

// Custom embeddings class for Gemini
class GeminiEmbeddings {
  private model: GenerativeModel;
  private fallbackEmbeddingSize: number = 768; // Standard embedding size

  constructor() {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    this.model = genAI.getGenerativeModel({ model: "embedding-001" });
  }

  private sanitizeText(text: string): string {
    return text
      .replace(/[^\w\s.,?!-]/g, "") // Remove special characters except basic punctuation
      .replace(/\s+/g, " ") // Normalize whitespace
      .trim()
      .slice(0, 2000); // Limit length to avoid token limits
  }

  private async generateSafeEmbedding(text: string): Promise<number[]> {
    try {
      const sanitizedText = this.sanitizeText(text);

      if (!sanitizedText) {
        console.warn("Empty text after sanitization, returning zero embedding");
        return new Array(this.fallbackEmbeddingSize).fill(0);
      }

      const result = await this.model.embedContent(sanitizedText);
      const embedding = await result.embedding;
      return Array.from(embedding.values);
    } catch (error) {
      if ((error as Error).message?.includes("SAFETY")) {
        console.warn(
          "Safety block encountered, attempting fallback processing"
        );
        // Try again with more aggressive sanitization
        const fallbackText = this.sanitizeText(text)
          .replace(/[.,?!-]/g, " ") // Remove all punctuation
          .replace(/\d+/g, "n") // Replace numbers with 'n'
          .toLowerCase();

        try {
          const fallbackResult = await this.model.embedContent(fallbackText);
          const fallbackEmbedding = await fallbackResult.embedding;
          return Array.from(fallbackEmbedding.values);
        } catch (fallbackError) {
          console.error("Fallback embedding failed:", fallbackError);
          // Return zero embedding as last resort
          return new Array(this.fallbackEmbeddingSize).fill(0);
        }
      }

      console.error("Error generating embedding:", error);
      return new Array(this.fallbackEmbeddingSize).fill(0);
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.generateSafeEmbedding(text);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    try {
      // Process texts in smaller batches to avoid rate limits
      const batchSize = 5;
      const embeddings: number[][] = [];

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map((text) => this.generateSafeEmbedding(text))
        );
        embeddings.push(...batchResults);

        // Add a small delay between batches to avoid rate limits
        if (i + batchSize < texts.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      return embeddings;
    } catch (error) {
      console.error("Error in batch embedding:", error);
      throw error;
    }
  }
}

export async function generateEmbeddingsInPineconeVectorStore(docId: string) {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("User not found");
  }

  let pineconeVectorStore;

  // Generate embeddings (numerical representations) for the split documents
  console.log("--- Generating embeddings... ---");
  const embeddings = new GeminiEmbeddings();

  const index = await pineconeClient.index(indexName);
  const namespaceAlreadyExists = await namespaceExists(index, docId);

  if (namespaceAlreadyExists) {
    console.log(
      `--- Namespace ${docId} already exists, reusing existing embeddings... ---`
    );

    pineconeVectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex: index,
      namespace: docId,
    });

    return pineconeVectorStore;
  } else {
    // If the namespace does not exist, download the PDF from firestore via the stored Download URL & generate the embeddings and store them in the Pinecone vector store
    const splitDocs = await generateDocs(docId);

    console.log(
      `--- Storing the embeddings in namespace ${docId} in the ${indexName} Pinecone vector store... ---`
    );

    pineconeVectorStore = await PineconeStore.fromDocuments(
      splitDocs,
      embeddings,
      {
        pineconeIndex: index,
        namespace: docId,
      }
    );

    return pineconeVectorStore;
  }
}

const generateLangchainCompletion = async (docId: string, question: string) => {
  let pineconeVectorStore;

  // eslint-disable-next-line prefer-const
  pineconeVectorStore = await generateEmbeddingsInPineconeVectorStore(docId);
  if (!pineconeVectorStore) {
    throw new Error("Pinecone vector store not found");
  }

  // Create a retriever to search through the vector store
  console.log("--- Creating a retriever... ---");
  const retriever = pineconeVectorStore.asRetriever();

  // Fetch the chat history from the database
  const chatHistory = await fetchMessagesFromDB(docId);

  // Define a prompt template for generating search queries based on conversation history
  console.log("--- Defining a prompt template... ---");
  const historyAwarePrompt = ChatPromptTemplate.fromMessages([
    ...chatHistory, // Insert the actual chat history here

    ["user", "{input}"],
    [
      "user",
      "Given the above conversation, generate a search query to look up in order to get information relevant to the conversation",
    ],
  ]);

  // Create a history-aware retriever chain that uses the model, retriever, and prompt
  console.log("--- Creating a history-aware retriever chain... ---");
  const historyAwareRetrieverChain = await createHistoryAwareRetriever({
    llm: model,
    retriever,
    rephrasePrompt: historyAwarePrompt,
  });

  // Define a prompt template for answering questions based on retrieved context
  console.log("--- Defining a prompt template for answering questions... ---");
  const historyAwareRetrievalPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Answer the user's questions based on the below context:\n\n{context}",
    ],
    ...chatHistory,
    ["user", "{input}"],
  ]);

  // Create a chain to combine the retrieved documents into a coherent response
  console.log("--- Creating a document combining chain... ---");
  const historyAwareCombineDocsChain = await createStuffDocumentsChain({
    llm: model,
    prompt: historyAwareRetrievalPrompt,
  });

  // Create the main retrieval chain that combines the history-aware retriever and document combining chains
  console.log("--- Creating the main retrieval chain... ---");
  const conversationalRetrievalChain = await createRetrievalChain({
    retriever: historyAwareRetrieverChain,
    combineDocsChain: historyAwareCombineDocsChain,
  });

  console.log("--- Running the chain with a sample conversation... ---");
  const reply = await conversationalRetrievalChain.invoke({
    chat_history: chatHistory,
    input: question,
  });

  // Print the result to the console
  console.log(reply.answer);
  return reply.answer;
};

// Export the model and the run function
export { model, generateLangchainCompletion };
