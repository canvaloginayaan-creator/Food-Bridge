import { onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';
import { collection, doc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { auth, db, googleProvider, isConfigured, errorMessage } from '../firebase.js';
import { escapeHTML, formatDate, ROLE_LABELS, safeExternalUrl } from '../model.js';
import { busy, setMessage } from '../ui.js';

const loading = document.getElementById('admin-loading');
const loginPanel = document.getElementById('admin-login-panel');
const loginControls = document.getElementById('admin-login-controls');
const loginMessage = document.getElementById('admin-login-message');
const denied = document.getElementById('admin-denied');
const content = document.getElementById('admin-content');
const signout = document.getElementById('admin-signout');
const adminMessage = document.getElementById('admin-message');
const loginForm = document.getElementById('admin-login-form');
const google = document.getElementById('admin-google');
let unsubscribers = [];
let accessUnsubscribe = null;
let authVersion = 0;
let currentAdmin = null;
let profiles = [];
let centers = [];

function stopListeners() { unsubscribers.forEach((unsubscribe) => unsubscribe()); unsubscribers = []; }
function clearAdminSession() {
  stopListeners();
  currentAdmin = null; profiles = []; centers = [];
  document.getElementById('admin-applications').innerHTML = '<div class="empty-state">Loading applications…</div>';
  document.getElementById('admin-centers').innerHTML = '<div class="empty-state">Loading locations…</div>';
  ['admin-pending', 'admin-approved', 'admin-locations'].forEach((id) => { document.getElementById(id).textContent = '—'; });
  document.getElementById('center-form').reset();
  document.getElementById('center-id').value = '';
  document.getElementById('center-active').checked = true;
  document.getElementById('center-form-title').textContent = 'Add a location';
  setMessage(adminMessage, '');
  setMessage(document.getElementById('center-message'), '');
}
const deniedMessage = denied.textContent;
function showLogin({ noAccess = false, reason = deniedMessage } = {}) {
  loading.hidden = true; content.hidden = true; loginPanel.hidden = false;
  denied.textContent = reason;
  denied.hidden = !noAccess; loginControls.hidden = noAccess; signout.hidden = !noAccess;
}

if (!isConfigured) {
  showLogin();
  document.getElementById('admin-setup').hidden = false;
  loginControls.querySelectorAll('button').forEach((button) => { button.disabled = true; });
} else {
  onAuthStateChanged(auth, (user) => {
    const version = ++authVersion;
    if (accessUnsubscribe) { accessUnsubscribe(); accessUnsubscribe = null; }
    clearAdminSession();
    setMessage(loginMessage, '');
    content.hidden = true;
    if (!user) { showLogin(); return; }
    if (!user.email) { showLogin({ noAccess: true }); return; }
    loading.hidden = false; loginPanel.hidden = true; signout.hidden = true;
    try {
      // Listen to the signed-in user's own record so granting or revoking access
      // takes effect without relying on custom claims or a token refresh.
      accessUnsubscribe = onSnapshot(doc(db, 'admins', user.uid), { includeMetadataChanges: true }, (snapshot) => {
        if (version !== authVersion) return;
        // Do not grant access on a stale offline cache. Firestore rules independently
        // enforce the same UID, active flag and authenticated-email checks.
        if (snapshot.metadata.fromCache) {
          clearAdminSession();
          showLogin({ noAccess: true, reason: 'Administrator access could not be verified. Check your connection and try again.' });
          return;
        }
        const record = snapshot.exists() ? snapshot.data() : null;
        if (record?.active !== true || record.email !== user.email) {
          clearAdminSession(); showLogin({ noAccess: true }); return;
        }
        if (currentAdmin?.uid === user.uid) return;
        currentAdmin = user;
        setMessage(loginMessage, '');
        loading.hidden = true; loginPanel.hidden = true; content.hidden = false; signout.hidden = false;
        startAdmin();
      }, (error) => {
        if (version !== authVersion) return;
        clearAdminSession();
        showLogin({ noAccess: true, reason: 'Administrator access could not be verified. Please try again.' });
        setMessage(loginMessage, errorMessage(error));
      });
    } catch (error) {
      if (version !== authVersion) return;
      clearAdminSession();
      showLogin({ noAccess: true, reason: 'Administrator access could not be verified. Please try again.' });
      setMessage(loginMessage, errorMessage(error));
    }
  });
  signout.addEventListener('click', async () => { try { await signOut(auth); } catch (error) { setMessage(loginMessage, errorMessage(error)); } });
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = loginForm.querySelector('[type=submit]');
    setMessage(loginMessage, ''); busy(button, true, 'Signing in…');
    try { await signInWithEmailAndPassword(auth, document.getElementById('admin-email').value.trim(), document.getElementById('admin-password').value); }
    catch (error) { setMessage(loginMessage, errorMessage(error)); }
    finally { busy(button, false); }
  });
  google.addEventListener('click', async () => {
    setMessage(loginMessage, ''); busy(google, true, 'Opening Google…');
    try { await signInWithPopup(auth, googleProvider); }
    catch (error) { setMessage(loginMessage, errorMessage(error)); }
    finally { busy(google, false); }
  });
}

function startAdmin() {
  unsubscribers.push(onSnapshot(collection(db, 'profiles'), (snapshot) => {
    profiles = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
    document.getElementById('admin-pending').textContent = profiles.filter((profile) => profile.status === 'pending').length;
    document.getElementById('admin-approved').textContent = profiles.filter((profile) => profile.status === 'approved').length;
    renderProfiles();
  }, (error) => setMessage(adminMessage, errorMessage(error))));
  unsubscribers.push(onSnapshot(collection(db, 'centers'), (snapshot) => {
    centers = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => a.name.localeCompare(b.name));
    document.getElementById('admin-locations').textContent = centers.filter((center) => center.active).length;
    renderCenters();
  }, (error) => setMessage(adminMessage, errorMessage(error))));
}

const statusFilter = document.getElementById('filter-status');
const roleFilter = document.getElementById('filter-role');
const applications = document.getElementById('admin-applications');
statusFilter.addEventListener('change', renderProfiles);
roleFilter.addEventListener('change', renderProfiles);

function renderProfiles() {
  const matches = profiles.filter((profile) => (statusFilter.value === 'all' || profile.status === statusFilter.value) && (roleFilter.value === 'all' || profile.role === roleFilter.value));
  if (!matches.length) { applications.innerHTML = '<div class="empty-state">No applications match these filters.</div>'; return; }
  applications.innerHTML = matches.map((profile) => {
    const website = safeExternalUrl(profile.website);
    const evidence = (Array.isArray(profile.evidenceUrls) ? profile.evidenceUrls : []).map(safeExternalUrl).filter(Boolean).map((url, index) => `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" class="button button-secondary button-small evidence-link">Open photo/video ${index + 1} ↗</a>`).join('');
    const legacyEvidence = Array.isArray(profile.evidencePaths) && profile.evidencePaths.length > 0;
    return `<article class="data-card"><div class="card-heading"><div><span class="section-label">${escapeHTML(ROLE_LABELS[profile.role] || profile.role)}</span><h3 style="margin-top:7px">${escapeHTML(profile.name)}</h3><p>Submitted ${escapeHTML(formatDate(profile.createdAt))}</p></div><span class="pill ${escapeHTML(profile.status)}">${profile.status === 'rejected' ? 'Changes requested' : escapeHTML(profile.status)}</span></div><div class="meta-grid"><div class="meta-item"><strong>Contact person</strong>${escapeHTML(profile.contactName)}</div><div class="meta-item"><strong>Email</strong>${escapeHTML(profile.email)}</div><div class="meta-item"><strong>Phone</strong>${escapeHTML(profile.phone)}</div><div class="meta-item"><strong>City / area</strong>${escapeHTML(profile.city)}</div>${profile.address ? `<div class="meta-item"><strong>Address</strong>${escapeHTML(profile.address)}</div>` : ''}${website ? `<div class="meta-item"><strong>Website</strong><a href="${escapeHTML(website)}" target="_blank" rel="noopener noreferrer">Visit website ↗</a></div>` : ''}</div>${profile.description ? `<p><strong>About their work:</strong> ${escapeHTML(profile.description)}</p>` : ''}${evidence ? `<div><span class="field-label">Photo / video links</span><div class="evidence-list">${evidence}</div><small class="field-help">These links open external websites supplied by the applicant.</small></div>` : ''}${legacyEvidence ? `<div class="notice mt-3">Previous uploads are unavailable without Firebase Storage. Request accessible photo or video links from the applicant.</div>` : ''}<div class="review-note"><label for="note-${escapeHTML(profile.id)}">Review note <span class="muted">(visible to applicant)</span></label><input id="note-${escapeHTML(profile.id)}" maxlength="500" value="${escapeHTML(profile.reviewNote || '')}" placeholder="Optional note; explain any changes requested"></div><div class="card-actions"><button type="button" class="button button-primary button-small" data-review="approved" data-id="${escapeHTML(profile.id)}">Approve</button><button type="button" class="button button-danger button-small" data-review="rejected" data-id="${escapeHTML(profile.id)}">Request changes</button></div></article>`;
  }).join('');
}
applications.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-review]');
  if (!button || !currentAdmin) return;
  const status = button.dataset.review;
  const original = profiles.find((profile) => profile.id === button.dataset.id);
  if (!original) return;
  const note = document.getElementById(`note-${button.dataset.id}`).value.trim();
  if (status === 'rejected' && !note) { setMessage(adminMessage, 'Please include a note explaining what the applicant needs to change.'); return; }
  if (!window.confirm(status === 'approved' ? 'Approve this account?' : 'Request changes to this application?')) return;
  setMessage(adminMessage, ''); busy(button, true, 'Saving…');
  try {
    const profileRef = doc(db, 'profiles', button.dataset.id);
    await runTransaction(db, async (transaction) => {
      const latest = await transaction.get(profileRef);
      if (!latest.exists() || latest.data().status !== original.status || latest.data().updatedAt?.toMillis() !== original.updatedAt?.toMillis()) {
        throw new Error('This application changed while you were reviewing it. Please review the latest details and try again.');
      }
      transaction.update(profileRef, { status, reviewNote: note, reviewedBy: currentAdmin.uid, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    let withdrawalWarning = '';
    if (status === 'rejected' && original.role === 'restaurant') {
      try {
        const snapshot = await getDocs(query(collection(db, 'listings'), where('restaurantId', '==', original.id)));
        const available = snapshot.docs.filter((listing) => listing.data().status === 'available');
        const results = await Promise.allSettled(available.map((listing) => updateDoc(doc(db, 'listings', listing.id), { status: 'cancelled', updatedAt: serverTimestamp() })));
        if (results.some((result) => result.status === 'rejected')) withdrawalWarning = ' Some available listings could not be withdrawn. New bookings remain blocked while the restaurant is unapproved.';
      } catch { withdrawalWarning = ' Available listings could not be checked. New bookings remain blocked while the restaurant is unapproved.'; }
    }
    setMessage(adminMessage, (status === 'approved' ? 'The account was approved.' : 'The applicant has been asked to update their application.') + withdrawalWarning, withdrawalWarning ? 'error' : 'success');
  } catch (error) { setMessage(adminMessage, errorMessage(error)); busy(button, false); }
});

const tabs = [document.getElementById('tab-applications'), document.getElementById('tab-centers')];
tabs.forEach((tab) => tab.addEventListener('click', () => {
  tabs.forEach((item) => { const selected = item === tab; item.setAttribute('aria-selected', String(selected)); document.getElementById(item.getAttribute('aria-controls')).hidden = !selected; });
  setMessage(adminMessage, '');
}));

const centerList = document.getElementById('admin-centers');
const centerForm = document.getElementById('center-form');
const centerMessage = document.getElementById('center-message');
const centerSubmit = document.getElementById('center-submit');
const centerField = (name) => document.getElementById(`center-${name}`);
function renderCenters() {
  if (!centers.length) { centerList.innerHTML = '<div class="empty-state">No centers or partner locations have been added yet.</div>'; return; }
  centerList.innerHTML = centers.map((center) => `<article class="data-card center-card"><div class="card-heading"><div><h3>${escapeHTML(center.name)}</h3><p>${escapeHTML(center.type === 'foodbridge' ? 'FoodBridge center' : 'Partner meal location')} · ${escapeHTML(center.city)}</p></div><span class="pill ${center.active ? 'approved' : 'cancelled'}">${center.active ? 'Published' : 'Hidden'}</span></div><p>${escapeHTML(center.address)}${center.hours ? `<br>${escapeHTML(center.hours)}` : ''}${center.phone ? `<br>${escapeHTML(center.phone)}` : ''}</p><div class="card-actions"><button class="button button-secondary button-small" type="button" data-edit-center="${escapeHTML(center.id)}">Edit</button><button class="button button-secondary button-small" type="button" data-toggle-center="${escapeHTML(center.id)}">${center.active ? 'Unpublish' : 'Publish'}</button></div></article>`).join('');
}
function resetCenterForm() { centerForm.reset(); centerField('id').value = ''; centerField('active').checked = true; document.getElementById('center-form-title').textContent = 'Add a location'; setMessage(centerMessage, ''); }
document.getElementById('center-reset').addEventListener('click', resetCenterForm);
centerList.addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-edit-center]');
  const toggle = event.target.closest('[data-toggle-center]');
  if (edit) {
    const center = centers.find((item) => item.id === edit.dataset.editCenter);
    if (!center) return;
    ['id', 'name', 'type', 'city', 'address', 'hours', 'phone'].forEach((name) => { centerField(name).value = center[name] || ''; });
    centerField('map').value = center.mapUrl || '';
    centerField('active').checked = center.active;
    document.getElementById('center-form-title').textContent = 'Edit location';
    setMessage(centerMessage, ''); centerForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (toggle) {
    const center = centers.find((item) => item.id === toggle.dataset.toggleCenter);
    if (!center) return;
    busy(toggle, true, 'Saving…');
    try { await updateDoc(doc(db, 'centers', center.id), { active: !center.active, updatedAt: serverTimestamp() }); setMessage(adminMessage, `Location ${center.active ? 'unpublished' : 'published'}.`, 'success'); }
    catch (error) { setMessage(adminMessage, errorMessage(error)); busy(toggle, false); }
  }
});
centerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(centerMessage, '');
  const mapInput = centerField('map').value.trim();
  const mapUrl = mapInput ? safeExternalUrl(mapInput) : '';
  if (mapInput && !mapUrl) { setMessage(centerMessage, 'Enter a valid map URL starting with http:// or https://.'); return; }
  const data = { name: centerField('name').value.trim(), type: centerField('type').value, city: centerField('city').value.trim(), address: centerField('address').value.trim(), hours: centerField('hours').value.trim(), phone: centerField('phone').value.trim(), mapUrl, active: centerField('active').checked };
  if (!data.name || !data.city || !data.address) { setMessage(centerMessage, 'Please complete the location name, city and address.'); return; }
  const existing = centers.find((item) => item.id === centerField('id').value);
  busy(centerSubmit, true, 'Saving…');
  try {
    const centerRef = existing ? doc(db, 'centers', existing.id) : doc(collection(db, 'centers'));
    await setDoc(centerRef, { ...data, createdAt: existing?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() });
    resetCenterForm(); setMessage(centerMessage, 'The location was saved.', 'success');
  } catch (error) { setMessage(centerMessage, errorMessage(error)); }
  finally { busy(centerSubmit, false); }
});
