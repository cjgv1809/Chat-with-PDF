"use client";

import { db } from "@/firebase";
import { useUser } from "@clerk/nextjs";
import { collection, doc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useCollection, useDocument } from "react-firebase-hooks/firestore";

// Number of docs the user is allowed to have
const PRO_LIMIT = 20;
const FREE_LIMIT = 2;

interface UserData {
  hasActiveMembership?: boolean;
  filesCount?: number;
  userLimit?: number;
}

function useSubscription() {
  const [hasActiveMembership, setHasActiveMembership] =
    useState<boolean>(false); // Initialize as false instead of null
  const [isOverFileLimit, setIsOverFileLimit] = useState<boolean>(false);
  const { user } = useUser();

  // Listen to the User document
  const [snapshot, loading, error] = useDocument(
    user ? doc(db, "users", user.id) : null,
    {
      snapshotListenOptions: { includeMetadataChanges: true },
    }
  );

  // Listen to the users files collection
  const [filesSnapshot, filesLoading] = useCollection(
    user ? collection(db, "users", user.id, "files") : null
  );

  useEffect(() => {
    if (!snapshot?.exists()) return;

    try {
      const data = snapshot.data() as UserData;

      console.log("User data:", data);

      // Set hasActiveMembership to false if it's undefined in the document
      setHasActiveMembership(!!data?.hasActiveMembership);
    } catch (err) {
      console.error("Error processing user document:", err);
      setHasActiveMembership(false);
    }
  }, [snapshot]);

  useEffect(() => {
    if (!filesSnapshot || hasActiveMembership === null) return;

    const files = filesSnapshot.docs;
    const usersLimit = hasActiveMembership ? PRO_LIMIT : FREE_LIMIT;

    console.log(
      "Checking if user is over file limit",
      files.length,
      usersLimit
    );
    setIsOverFileLimit(files.length >= usersLimit);
  }, [filesSnapshot, hasActiveMembership]);

  return { hasActiveMembership, loading, error, isOverFileLimit, filesLoading };
}

export default useSubscription;
