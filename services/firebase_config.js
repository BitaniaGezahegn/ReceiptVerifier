// Import Firebase modules. 
// NOTE: In MV3, these must be local files or bundled. 
// If using a bundler (Webpack/Vite), import from 'firebase/app', etc.
// If no bundler, download the ESM builds to a 'firebase' folder.
import { initializeApp } from '../firebase/firebase-app.js'; 
import { getFirestore } from '../firebase/firebase-firestore.js';
import { getAuth } from '../firebase/firebase-auth.js';

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCDiPvi4ez-qzRVxJ18hFJG3kFP9Ozs8Ww",
  authDomain: "ebirr-receipt-verifier-a727d.firebaseapp.com",
  projectId: "ebirr-receipt-verifier-a727d",
  storageBucket: "ebirr-receipt-verifier-a727d.firebasestorage.app",
  messagingSenderId: "416782255208",
  appId: "1:416782255208:web:47ac00ee88ea4e01a927dd",
  measurementId: "G-4710QWPEVC"
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { db, auth };