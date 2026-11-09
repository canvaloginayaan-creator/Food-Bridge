import { signInWithEmailAndPassword, signInWithPopup, sendPasswordResetEmail } from 'firebase/auth';
import { auth, googleProvider, isConfigured, errorMessage } from '../firebase.js';
import { currentUser, redirectToAccount } from '../session.js';
import { installShell, setMessage, busy } from '../ui.js';

installShell();
const form = document.getElementById('login-form');
const message = document.getElementById('login-message');
const google = document.getElementById('google-login');
const submit = form.querySelector('[type=submit]');
const reset = document.getElementById('forgot-password');

if (!isConfigured) {
  document.getElementById('setup-message').hidden = false;
  [google, submit, reset].forEach((button) => { button.disabled = true; });
} else {
  currentUser().then((user) => user && redirectToAccount(user)).catch((error) => setMessage(message, errorMessage(error)));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage(message, '');
    busy(submit, true, 'Signing in…');
    try {
      const credential = await signInWithEmailAndPassword(auth, document.getElementById('login-email').value.trim(), document.getElementById('login-password').value);
      await redirectToAccount(credential.user);
    } catch (error) { setMessage(message, errorMessage(error)); busy(submit, false); }
  });
  google.addEventListener('click', async () => {
    setMessage(message, '');
    busy(google, true, 'Opening Google…');
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      await redirectToAccount(credential.user);
    } catch (error) { setMessage(message, errorMessage(error)); busy(google, false); }
  });
  reset.addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    if (!email || !document.getElementById('login-email').validity.valid) {
      setMessage(message, 'Enter your email address above, then select “Forgot password?”');
      return;
    }
    busy(reset, true, 'Sending…');
    try {
      await sendPasswordResetEmail(auth, email);
      setMessage(message, 'If an account exists for this email, password reset instructions will be sent.', 'success');
    } catch (error) {
      if (error.code === 'auth/user-not-found') setMessage(message, 'If an account exists for this email, password reset instructions will be sent.', 'success');
      else setMessage(message, errorMessage(error));
    } finally { busy(reset, false); }
  });
}
