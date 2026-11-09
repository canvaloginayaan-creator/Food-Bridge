import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase Web app configuration. These values identify the project and are
// included in the browser bundle; never put an Admin SDK private key here.
const firebaseConfig = {
  apiKey: 'AIzaSyBPtsRyCflgF6XVCJeospBEn5oYmwt-edk',
  authDomain: 'food-bridge-53bb7.firebaseapp.com',
  projectId: 'food-bridge-53bb7',
  storageBucket: 'food-bridge-53bb7.firebasestorage.app',
  messagingSenderId: '765600508730',
  appId: '1:765600508730:web:3dd5b247fe3c4b95883e03',
  measurementId: 'G-KQ4Z2LD3XT'
};

// An optional environment override must contain every required value. Using a
// partial override could accidentally mix resources from different projects.
const environmentConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};
const config = Object.values(environmentConfig).some(Boolean) ? environmentConfig : firebaseConfig;

export const isConfigured = ['apiKey', 'authDomain', 'projectId', 'appId']
  .every((key) => Boolean(config[key]) && !String(config[key]).includes('YOUR_'));

const app = isConfigured ? initializeApp(config) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function errorMessage(error) {
  const messages = {
    'auth/invalid-credential': 'The email or password is incorrect. Please try again.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/email-already-in-use': 'An account already exists with this email. Please sign in instead.',
    'auth/weak-password': 'Please choose a password with at least 6 characters.',
    'auth/operation-not-allowed': 'This sign-in method has not been enabled in Firebase yet.',
    'auth/unauthorized-domain': 'This website domain has not been authorized in Firebase Authentication yet.',
    'auth/popup-blocked': 'Your browser blocked the sign-in window. Please allow pop-ups and try again.',
    'auth/popup-closed-by-user': 'The sign-in window was closed before sign-in was completed.',
    'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method.',
    'auth/too-many-requests': 'Too many attempts. Please wait a little while and try again.',
    'auth/network-request-failed': 'Could not reach Firebase. Check your internet connection and try again.',
    'permission-denied': 'This action is not permitted for your account, or your approval status has changed.',
    'unavailable': 'The service is temporarily unavailable. Please try again.'
  };
  return messages[error?.code] || error?.message || 'Something went wrong. Please try again.';
}
