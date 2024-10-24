"use client";

import React, { useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import {
  CheckCircleIcon,
  CircleArrowDown,
  HammerIcon,
  RocketIcon,
  SaveIcon,
} from "lucide-react";
// import useUpload, { StatusText } from "@/hooks/useUpload";
import { useRouter } from "next/navigation";
import useUpload, { StatusText, Status } from "@/hooks/useUpload";
// import useSubscription from "@/hooks/useSubscription";
// import { useToast } from "./ui/use-toast";

function FileUploader() {
  const { progress, status, fileId, handleUpload } = useUpload() as {
    progress: number | null;
    status: StatusText;
    fileId: string | null;
    handleUpload: (file: File) => Promise<void>;
  };
  // const { isOverFileLimit, filesLoading } = useSubscription();
  const router = useRouter();
  // const { toast } = useToast();

  useEffect(() => {
    if (fileId) {
      router.push(`/dashboard/files/${fileId}`);
    }
  }, [fileId, router]);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      // Do something with the files

      const file = acceptedFiles[0];
      if (file) {
        // if (!isOverFileLimit && !filesLoading) {
        await handleUpload(file);
        // } else {
        // toast({
        //   variant: "destructive",
        //   title: "Free Plan File Limit Reached",
        //   description:
        //     "You have reached the maximum number of files allowed for your account. Please upgrade to add more documents.",
        // });
      }
    },
    // [handleUpload, isOverFileLimit, filesLoading, toast]
    [handleUpload]
  );

  const statusIcons: {
    [key in StatusText]: JSX.Element;
  } = {
    [StatusText.UPLOADING]: (
      <RocketIcon className="h-20 w-20 text-indigo-600" />
    ),
    [StatusText.UPLOADED]: (
      <CheckCircleIcon className="h-20 w-20 text-indigo-600" />
    ),
    [StatusText.SAVING]: <SaveIcon className="h-20 w-20 text-indigo-600" />,
    [StatusText.GENERATING]: (
      <HammerIcon className="h-20 w-20 text-indigo-600 animate-bounce" />
    ),
  };

  const { getRootProps, getInputProps, isDragActive, isFocused, isDragAccept } =
    useDropzone({
      onDrop,
      maxFiles: 1,
      accept: {
        "application/pdf": [".pdf"],
      },
    });

  const uploadInProgress = progress != null && progress >= 0 && progress <= 100;

  return (
    <div className="flex flex-col gap-4 items-center max-w-7xl mx-auto">
      {/* Loading... tomorrow! */}
      {uploadInProgress && (
        <div className="flex flex-col justify-center items-center gap-5">
          <div
            className={`radial-progress bg-indigo-300 text-white border-indigo-600 border-4 ${
              progress === 100 && "hidden"
            }`}
            role="progressbar"
            style={
              {
                "--value": progress,
                "--size": "12rem",
                "--thickness": "1.3rem",
              } as React.CSSProperties
            }
          >
            {progress} %
          </div>

          {/* Render Status Icon */}
          {statusIcons[status]}

          <p className="text-indigo-600 animate-pulse">{status.toString()}</p>
        </div>
      )}

      {!uploadInProgress && (
        <div
          {...getRootProps()}
          className={`p-10 border-2 border-dashed mt-10 w-[90%]  border-indigo-600 text-indigo-600 rounded-lg h-96 flex items-center justify-center ${
            isFocused || isDragAccept ? "bg-indigo-300" : "bg-indigo-100"
          }`}
        >
          <input {...getInputProps()} />

          <div className="flex flex-col items-center justify-center">
            {isDragActive ? (
              <>
                <RocketIcon className="h-20 w-20 animate-ping" />
                <p>Drop the files here ...</p>
              </>
            ) : (
              <>
                <CircleArrowDown className="h-20 w-20 animate-bounce" />
                <p>Drag n drop some files here, or click to select files</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default FileUploader;
