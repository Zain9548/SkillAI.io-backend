
import { initializeApp } from "firebase/app";
import {getAuth, GoogleAuthProvider} from "firebase/auth"
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_APIKEY,
  authDomain: "skillai-2230a.firebaseapp.com",
  projectId: "skillai-2230a",
  storageBucket: "skillai-2230a.firebasestorage.app",
  messagingSenderId: "222900365081",
  appId: "1:222900365081:web:8954d042f27fe9e2594788"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const provider = new GoogleAuthProvider()

export {auth , provider}