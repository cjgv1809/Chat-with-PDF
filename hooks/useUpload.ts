"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
// import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { db, storage } from "@/firebase";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { generateEmbeddings } from "@/actions/generateEmbeddings";

export enum StatusText {
  UPLOADING = "Uploading file...",
  UPLOADED = "File uploaded successfully",
  SAVING = "Saving file to database...",
  GENERATING = "Generating AI Embeddings, This will only take a few seconds...",
}

export type Status = StatusText[keyof StatusText];

function useUpload() {
  const [progress, setProgress] = useState<number | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const { user } = useUser();
  // const router = useRouter();

  const handleUpload = async (file: File) => {
    if (!user || !file) return;

    const fileIdToUploadTo = uuidv4();

    const storageRef = ref(storage, `users/${user.id}/${fileIdToUploadTo}`);

    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const progress = Math.round(
          (snapshot.bytesTransferred / snapshot.totalBytes) * 100
        );
        setStatus(StatusText.UPLOADING);
        setProgress(progress);
      },
      (error) => {
        console.error("Error uploading file", error);
      },
      async () => {
        setStatus(StatusText.UPLOADED);
        setProgress(null);

        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);

        setStatus(StatusText.SAVING);
        await setDoc(doc(db, "users", user.id, "files", fileIdToUploadTo), {
          name: file.name,
          size: file.size,
          type: file.type,
          downloadUrl: downloadUrl,
          ref: uploadTask.snapshot.ref.fullPath,
          createdAt: serverTimestamp(),
        });

        setStatus(StatusText.GENERATING);
        // generate AI embeddings
        await generateEmbeddings(fileIdToUploadTo);

        setFileId(fileIdToUploadTo);
      }
    );
  };

  return { progress, status, fileId, handleUpload };
}

export default useUpload;
