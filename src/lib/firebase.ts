import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  onSnapshot, 
  updateDoc, 
  deleteDoc, 
  Timestamp, 
  getDocFromServer, 
  orderBy, 
  limit, 
  writeBatch,
  initializeFirestore,
  enableNetwork
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Initialize Firestore with settings to handle potential connectivity issues in iframe/restricted environments.
// experimentalForceLongPolling is often necessary in AI Studio's preview iframe to avoid WebSocket connection failures.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId || '(default)');
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  onSnapshot, 
  updateDoc, 
  deleteDoc, 
  Timestamp,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  orderBy,
  limit,
  writeBatch
};
export type { User };

// Test connection
async function testConnection() {
  try {
    console.log("Testing Firestore connection...");
    console.log("Database ID:", firebaseConfig.firestoreDatabaseId || '(default)');
    console.log("Project ID:", firebaseConfig.projectId);
    
    // Check auth status
    onAuthStateChanged(auth, (user) => {
      if (user) {
        console.log("Auth State: Signed in as", user.email, "(Verified:", user.emailVerified, ")");
      } else {
        console.log("Auth State: Signed out");
      }
    });

    // Use getDocFromServer to bypass local cache and test real connectivity
    // Path /test/connection is allowed for read in firestore.rules
    const testDoc = doc(db, 'test', 'connection');
    await getDocFromServer(testDoc);
    console.log("Firestore connection successful.");
  } catch (error) {
    if (error instanceof Error) {
      console.error("Firestore connection failed with error code:", (error as any).code);
      console.error("Error message:", error.message);
      
      if (error.message.includes('the client is offline') || (error as any).code === 'unavailable') {
        console.error("Firestore connection failed: The backend is unreachable. This usually means:");
        console.error("1. The Firestore Database ID is incorrect.");
        console.error("2. Cloud Firestore API is not enabled for this project.");
        console.error("3. Network/Iframe restrictions are blocking the connection.");
        console.error("4. The project is currently being provisioned.");
      } else if (error.message.includes('Missing or insufficient permissions')) {
        console.warn("Firestore connection: Connected, but received permission error for test document. This is expected if the document is protected, but the 'test/connection' rule should allow public read.");
      }
    } else {
      console.error("Firestore connection test failed with unknown error:", error);
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
