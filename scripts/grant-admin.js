// Run only on a trusted machine with Application Default Credentials. This
// script is never bundled into the website and never accepts browser input.
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const [kind, value] = process.argv.slice(2);
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId || !['--email', '--uid'].includes(kind) || !value) {
  console.error('Usage: FIREBASE_PROJECT_ID=your-project npm run grant-admin -- --email admin@example.com');
  console.error('Or use --uid <Firebase Authentication UID>. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON outside this repository.');
  process.exit(1);
}
try {
  const app = initializeApp({ credential: applicationDefault(), projectId });
  const auth = getAuth(app);
  const user = kind === '--email' ? await auth.getUserByEmail(value) : await auth.getUser(value);
  if (!user.email) throw new Error('The Firebase Authentication user must have an email address.');
  await getFirestore(app).collection('admins').doc(user.uid).set({ active: true, email: user.email }, { merge: true });
  console.log(`Administrator access enabled for ${user.email} (${user.uid}) in Firestore.`);
} catch (error) {
  console.error('Could not update the administrator record:', error.message);
  process.exitCode = 1;
}
