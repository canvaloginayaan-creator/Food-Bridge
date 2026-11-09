import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth, db, errorMessage, isConfigured } from './firebase.js';
import { dashboardFor, escapeHTML } from './model.js';

export function currentUser() {
  if (!auth) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let unsubscribe;
    let completedSynchronously = false;
    unsubscribe = onAuthStateChanged(auth, (user) => {
      if (unsubscribe) unsubscribe();
      else completedSynchronously = true;
      resolve(user);
    }, reject);
    if (completedSynchronously) unsubscribe();
  });
}

export async function getProfile(uid) {
  const snapshot = await getDoc(doc(db, 'profiles', uid));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function redirectToAccount(user) {
  const profile = await getProfile(user.uid);
  window.location.assign(dashboardFor(profile));
}

let loggingOut = false;
export async function logOut() {
  loggingOut = true;
  try {
    if (auth) await signOut(auth);
    window.location.assign('index.html');
  } catch (error) {
    loggingOut = false;
    throw error;
  }
}

function state(title, message, links = '') {
  const node = document.getElementById('access-state');
  if (!node) return;
  node.hidden = false;
  node.innerHTML = `<div class="state-card"><div class="state-icon">✳</div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(message)}</p><div class="button-row">${links}</div></div>`;
}

// UI guards improve the experience; Firestore rules enforce the same
// permissions independently, including when requests bypass this page entirely.
export async function protectPage(roles, { requireApproval = true } = {}) {
  if (!isConfigured) {
    state('Firebase setup required', 'This website has not been connected to its Firebase project yet. Please ask the site administrator to complete the setup.');
    return null;
  }
  try {
    const user = await currentUser();
    if (!user) {
      state('Please sign in', 'Sign in to access your FoodBridge account.', '<a class="button button-primary" href="login.html">Log in</a><a class="button button-secondary" href="register.html">Create an account</a>');
      return null;
    }
    const profile = await getProfile(user.uid);
    if (!profile) {
      state('Complete your registration', 'Your sign-in is ready, but we still need your registration details.', '<a class="button button-primary" href="register.html?finish=1">Complete registration</a>');
      return null;
    }
    if (!roles.includes(profile.role)) {
      const destination = dashboardFor(profile);
      state('This area is for a different account type', 'Your account has its own FoodBridge space.', `<a class="button button-primary" href="${escapeHTML(destination)}">Go to my account</a>`);
      return null;
    }
    if (requireApproval && profile.status !== 'approved') {
      state('Your application is being reviewed', 'Restaurant and organization accounts can access food tools after approval.', '<a class="button button-primary" href="application.html">View application status</a>');
      return null;
    }
    const content = document.getElementById('protected-content');
    if (content) content.hidden = false;
    const loading = document.getElementById('access-state');
    if (loading) loading.hidden = true;

    // If an administrator revokes approval or the user signs out in another tab,
    // remove the protected content instead of leaving a stale dashboard visible.
    onSnapshot(doc(db, 'profiles', user.uid), (snapshot) => {
      if (!snapshot.exists()) {
        window.location.replace('register.html?finish=1');
        return;
      }
      const latest = snapshot.data();
      if (!roles.includes(latest.role) || (requireApproval && latest.status !== 'approved')) {
        window.location.replace(dashboardFor(latest));
      }
    }, () => {
      if (content) content.hidden = true;
      state('Unable to check access', 'Your account permissions could not be verified. Please refresh or sign in again.');
    });
    onAuthStateChanged(auth, (nextUser) => {
      if ((!nextUser || nextUser.uid !== user.uid) && !loggingOut) window.location.replace('login.html');
    });
    return { user, profile };
  } catch (error) {
    state('Unable to load your account', errorMessage(error));
    return null;
  }
}
