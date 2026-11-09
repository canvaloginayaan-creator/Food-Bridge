import { doc, onSnapshot } from 'firebase/firestore';
import { db, errorMessage } from '../firebase.js';
import { dashboardFor, escapeHTML, ROLE_LABELS } from '../model.js';
import { protectPage } from '../session.js';
import { installShell } from '../ui.js';

installShell();
async function init() {
const session = await protectPage(['restaurant', 'organization'], { requireApproval: false });
if (session) {
  onSnapshot(doc(db, 'profiles', session.user.uid), (snapshot) => {
    if (!snapshot.exists()) return;
    const profile = snapshot.data();
    const card = document.getElementById('application-card');
    const role = escapeHTML(ROLE_LABELS[profile.role] || 'Account');
    if (profile.status === 'approved') {
      card.innerHTML = `<span class="pill approved">Approved</span><h2 style="font-size:2rem;margin:15px 0 8px">You’re ready to get started.</h2><p>Your ${role.toLowerCase()} application has been approved. Your account tools are now available.</p><a class="button button-primary" href="${escapeHTML(dashboardFor(profile))}">Go to my dashboard →</a>`;
    } else if (profile.status === 'rejected') {
      card.innerHTML = `<span class="pill rejected">Changes requested</span><h2 style="font-size:2rem;margin:15px 0 8px">Your application needs an update.</h2><p>Our team was unable to approve the application as submitted. Update the details and send them for review again.</p>${profile.reviewNote ? `<div class="notice"><strong>Note from the team</strong><p>${escapeHTML(profile.reviewNote)}</p></div>` : ''}<a class="button button-primary mt-3" href="register.html?edit=1">Update my application →</a>`;
    } else {
      card.innerHTML = `<span class="pill pending">Pending review</span><h2 style="font-size:2rem;margin:15px 0 8px">Thank you for joining us.</h2><p>We have received your ${role.toLowerCase()} registration. Our team will review the information and verification materials you provided.</p><p class="text-small mb-0">Your sharing tools will appear here once your account is approved.</p>`;
    }
  }, (error) => { document.getElementById('application-card').textContent = errorMessage(error); });
}

}
init();
