import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

// Add Gemini per-user quota scope to the Google provider
// This allows us to get the access token directly from the Firebase sign-in result
googleProvider.addScope('https://www.googleapis.com/auth/generative-language.peruserquota');
