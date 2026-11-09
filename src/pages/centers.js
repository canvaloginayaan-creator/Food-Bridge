import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db, errorMessage } from '../firebase.js';
import { escapeHTML, safeExternalUrl } from '../model.js';
import { protectPage } from '../session.js';
import { installShell } from '../ui.js';

installShell();
async function init() {
const session = await protectPage(['individual'], { requireApproval: false });
if (session) {
  const banner = document.getElementById('individual-status');
  onSnapshot(doc(db, 'profiles', session.user.uid), (snapshot) => {
    if (!snapshot.exists()) return;
    const profile = snapshot.data();
    banner.innerHTML = profile.status === 'rejected'
      ? `Your registration was received. You can still view meal locations. ${profile.reviewNote ? `Team note: ${escapeHTML(profile.reviewNote)}. ` : ''}<a class="text-link" href="register.html?edit=1">Update your registration →</a>`
      : profile.status === 'approved' ? 'Your registration has been reviewed. You can view the meal locations below.'
      : 'Your registration is complete. You can view meal locations while the FoodBridge team reviews your details.';
  }, (error) => { banner.textContent = errorMessage(error); });
  const list = document.getElementById('centers-list');
  const search = document.getElementById('center-search');
  let centers = [];
  function render() {
    const text = search.value.trim().toLowerCase();
    const matches = centers.filter((center) => `${center.name} ${center.city} ${center.address}`.toLowerCase().includes(text));
    if (!matches.length) {
      list.innerHTML = `<div class="empty-state">${centers.length ? 'No locations match your search.' : 'No locations have been added yet. Please check back after the FoodBridge team publishes a center or partner.'}</div>`;
      return;
    }
    list.innerHTML = matches.map((center) => {
      const map = safeExternalUrl(center.mapUrl);
      return `<article class="data-card center-card"><div class="card-heading"><h3>${escapeHTML(center.name)}</h3><span class="pill">${center.type === 'foodbridge' ? 'FoodBridge center' : 'Partner location'}</span></div><p>${escapeHTML(center.address)}<br>${escapeHTML(center.city)}</p><div class="meta-grid"><div class="meta-item"><strong>Meal / opening hours</strong>${escapeHTML(center.hours || 'Please contact the location')}</div><div class="meta-item"><strong>Contact</strong>${escapeHTML(center.phone || 'Not provided')}</div></div>${map ? `<a class="text-link map-link" href="${escapeHTML(map)}" target="_blank" rel="noopener noreferrer">Open map ↗</a>` : ''}</article>`;
    }).join('');
  }
  search.addEventListener('input', render);
  onSnapshot(query(collection(db, 'centers'), where('active', '==', true)), (snapshot) => {
    centers = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
    render();
  }, (error) => { list.innerHTML = `<div class="notice error">${escapeHTML(errorMessage(error))}</div>`; });
}

}
init();
