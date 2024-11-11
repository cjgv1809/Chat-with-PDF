"use server";

import { adminDb, adminStorage } from "@/firebaseAdmin";
import { indexName } from "@/lib/langchain";
import pineconeClient from "@/lib/pinecone";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

export async function deleteDocument(docId: string) {
  auth().protect();

  const { userId } = await auth();

  try {
    // Delete the document from the database
    await adminDb
      .collection("users")
      .doc(userId!)
      .collection("files")
      .doc(docId)
      .delete();

    // Delete from firebase storage
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
    const filePath = `users/${userId}/files/${docId}`;
    console.log(`Deleting file from bucket: ${bucketName}, path: ${filePath}`);

    await adminStorage.bucket(bucketName).file(filePath).delete();

    console.log(`File deleted successfully: ${filePath}`);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Error deleting file: ${error.message}`);
    } else {
      console.error(`Error deleting file: ${error}`);
    }
  }

  try {
    // Delete all embeddings associated with the document
    const index = await pineconeClient.index(indexName);
    await index.namespace(docId).deleteAll();
    console.log(`Embeddings deleted successfully for document: ${docId}`);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Error deleting embeddings: ${error.message}`);
    } else {
      console.error(`Error deleting embeddings: ${error}`);
    }
  }

  // Revalidate the dashboard page to ensure the documents are up to date
  revalidatePath("/dashboard");
}
