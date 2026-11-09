import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider, isConfigured, errorMessage } from '../firebase.js';
import { dashboardFor, ROLES, safeExternalUrl, parseEvidenceUrls } from '../model.js';
import { getProfile } from '../session.js';
import { installShell, setMessage, busy } from '../ui.js';

installShell();
const form = document.getElementById('register-form');
const message = document.getElementById('register-message');
const submit = document.getElementById('register-submit');
const google = document.getElementById('google-register');
const fields = (id) => document.getElementById(`register-${id}`);
const roles = [...form.querySelectorAll('input[name=role]')];
const params = new URLSearchParams(window.location.search);
let user = null;
let oldProfile = null;
let submitting = false;
let authVersion = 0;

const requestedRole = params.get('role');
if (ROLES.includes(requestedRole)) form.querySelector(`[name=role][value=${requestedRole}]`).checked = true;

function selectedRole() { return form.querySelector('[name=role]:checked')?.value || ''; }
function updateRole() {
  const role = selectedRole();
  const business = role === 'restaurant' || role === 'organization';
  form.querySelectorAll('[data-business-only]').forEach((node) => { node.hidden = !business; });
  ['contact', 'address', 'description'].forEach((name) => { fields(name).required = business; });
  fields('website').disabled = !business;
  fields('evidence').disabled = !business;
  document.getElementById('name-label').textContent = role === 'restaurant' ? 'Restaurant / business name' : role === 'organization' ? 'Organization name' : 'Your full name';
}
roles.forEach((radio) => radio.addEventListener('change', updateRole));
updateRole();

function showAccount(signedInUser) {
  const signedIn = Boolean(signedInUser);
  document.getElementById('new-account').hidden = signedIn;
  document.getElementById('signed-account').hidden = !signedIn;
  fields('email').required = !signedIn;
  fields('password').required = !signedIn;
  fields('email').disabled = signedIn;
  fields('password').disabled = signedIn;
  document.getElementById('signed-email').textContent = signedInUser?.email || '';
}

function populateRejected(profile) {
  document.getElementById('register-heading').textContent = 'Update your application';
  document.getElementById('register-intro').textContent = 'Update your details and submit them for review again.';
  form.querySelector(`[name=role][value=${profile.role}]`).checked = true;
  roles.forEach((radio) => { radio.disabled = radio.value !== profile.role; });
  ['name', 'contact', 'phone', 'city', 'address', 'website', 'description'].forEach((name) => {
    fields(name).value = profile[name === 'contact' ? 'contactName' : name] || '';
  });
  fields('evidence').value = Array.isArray(profile.evidenceUrls) ? profile.evidenceUrls.join('\n') : '';
  if (profile.evidencePaths?.length) document.getElementById('evidence-help').textContent = 'Previous uploads are no longer available here. Please provide a website or accessible photo/video links, one per line.';
  updateRole();
}

if (!isConfigured) {
  document.getElementById('setup-message').hidden = false;
  google.disabled = true;
} else {
  onAuthStateChanged(auth, async (nextUser) => {
    const version = ++authVersion;
    user = nextUser;
    oldProfile = null;
    showAccount(nextUser);
    submit.disabled = true;
    roles.forEach((radio) => { radio.disabled = false; });
    if (nextUser) {
      try {
        const profile = await getProfile(nextUser.uid);
        if (version !== authVersion || submitting) return;
        if (profile) {
          if (profile.status === 'rejected' && params.get('edit') === '1') {
            oldProfile = profile;
            populateRejected(profile);
          } else {
            window.location.replace(dashboardFor(profile));
            return;
          }
        } else if (!fields('name').value && nextUser.displayName && selectedRole() === 'individual') {
          fields('name').value = nextUser.displayName;
        }
      } catch (error) { setMessage(message, errorMessage(error)); return; }
    }
    submit.disabled = false;
  });

  google.addEventListener('click', async () => {
    setMessage(message, '');
    busy(google, true, 'Opening Google…');
    try { await signInWithPopup(auth, googleProvider); }
    catch (error) { setMessage(message, errorMessage(error)); }
    finally { busy(google, false); }
  });
  document.getElementById('switch-account').addEventListener('click', async () => {
    try { await signOut(auth); window.location.assign('register.html'); }
    catch (error) { setMessage(message, errorMessage(error)); }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    setMessage(message, '');
    const role = selectedRole();
    if (!ROLES.includes(role)) { setMessage(message, 'Please choose how you are joining FoodBridge.'); return; }
    const business = role !== 'individual';
    const websiteInput = business ? fields('website').value.trim() : '';
    const website = websiteInput ? safeExternalUrl(websiteInput) : '';
    if (websiteInput && !website) { setMessage(message, 'Please enter a valid website starting with http:// or https://.'); return; }
    const { urls: evidenceUrls, error: evidenceError } = parseEvidenceUrls(business ? fields('evidence').value : '');
    if (evidenceError) { setMessage(message, evidenceError); return; }
    if (business && !website && !evidenceUrls.length) { setMessage(message, 'Please provide a website / social page or at least one photo or video link for verification.'); return; }
    const data = {
      role,
      name: fields('name').value.trim(),
      contactName: business ? fields('contact').value.trim() : fields('name').value.trim(),
      phone: fields('phone').value.trim(),
      city: fields('city').value.trim(),
      address: business ? fields('address').value.trim() : '',
      website,
      description: business ? fields('description').value.trim() : ''
    };
    if (Object.entries(data).some(([key, value]) => ['name', 'contactName', 'phone', 'city'].includes(key) && !value) || (business && (!data.address || !data.description))) {
      setMessage(message, 'Please complete all required details.'); return;
    }
    if (data.phone.length < 7) { setMessage(message, 'Please enter a phone number with at least 7 characters.'); return; }
    const email = fields('email').value.trim();
    const password = fields('password').value;
    submitting = true;
    busy(submit, true, 'Submitting registration…');
    try {
      if (!user) {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        user = credential.user;
      }
      const existing = await getProfile(user.uid);
      if (existing && !(oldProfile && existing.status === 'rejected')) {
        window.location.assign(dashboardFor(existing));
        return;
      }
      const application = {
        ...data,
        uid: user.uid,
        email: user.email,
        status: 'pending',
        evidenceUrls,
        createdAt: oldProfile?.createdAt || serverTimestamp(),
        consentAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        reviewedAt: null,
        reviewedBy: '',
        reviewNote: ''
      };
      await setDoc(doc(db, 'profiles', user.uid), application);
      window.location.assign(dashboardFor(application));
    } catch (error) {
      setMessage(message, `${errorMessage(error)}${user ? ' Your sign-in is saved; you can correct your details and submit again.' : ''}`);
      showAccount(user);
      busy(submit, false);
      submitting = false;
    }
  });
}
