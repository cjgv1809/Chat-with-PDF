import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDUd2q7uBr2tMWEODq5Wiqfz5NkZzbDkQw",
  authDomain: "chat-with-pdf-7030a.firebaseapp.com",
  projectId: "chat-with-pdf-7030a",
  storageBucket: "chat-with-pdf-7030a.appspot.com",
  messagingSenderId: "549842356895",
  appId: "1:549842356895:web:c61cce4bc2f2d33b7bb0aa",
  measurementId: "G-BZ9WDWNXVR",
};

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

const db = getFirestore(app);
const storage = getStorage(app);

export { db, storage };
