import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db, errorMessage, isConfigured } from '../firebase.js';
import { escapeHTML, formatDate } from '../model.js';
import { busy, foodPhotoMarkup, hideBrokenFoodPhotos, setMessage } from '../ui.js';

const $ = (id) => document.getElementById(id);
const foodList = $('ops-food-list');
const bookingList = $('ops-booking-list');
const message = $('ops-message');
const foodSearch = $('ops-food-search');
const foodStatus = $('ops-food-status');
const foodCenter = $('ops-food-center');
const bookingSearch = $('ops-booking-search');
const bookingStatus = $('ops-booking-status');
const bookingCenter = $('ops-booking-center');
const countIds = ['ops-available-count', 'ops-booked-count', 'ops-collected-count'];

// The existing administration module still handles accounts and centers.
// Keep all four tabs in sync, including the two original tabs.
const tabs = [...document.querySelectorAll('#admin-content .admin-tabs [role="tab"]')];
tabs.forEach((tab) => tab.addEventListener('click', () => {
  tabs.forEach((item) => {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    $(item.getAttribute('aria-controls')).hidden = !selected;
  });
  setMessage(message, '');
}));

hideBrokenFoodPhotos(foodList);
hideBrokenFoodPhotos(bookingList);

let currentAdmin = null;
let authVersion = 0;
let sessionVersion = 0;
let stopAccess = null;
let stops = [];
let actionBusy = false;
let data = { profiles: [], centers: [], listings: [], bookings: [] };
let loaded = new Set();
let failed = new Set();

function clearOperations() {
  sessionVersion += 1;
  stops.forEach((stop) => stop());
  stops = [];
  currentAdmin = null;
  data = { profiles: [], centers: [], listings: [], bookings: [] };
  loaded = new Set();
  failed = new Set();
  actionBusy = false;
  foodList.innerHTML = '<div class="empty-state">Loading food listings…</div>';
  bookingList.innerHTML = '<div class="empty-state">Loading bookings…</div>';
  countIds.forEach((id) => { $(id).textContent = '—'; });
  foodSearch.value = '';
  bookingSearch.value = '';
  foodStatus.value = 'all';
  bookingStatus.value = 'all';
  foodCenter.innerHTML = '<option value="all">All FoodBridge centers</option>';
  bookingCenter.innerHTML = '<option value="all">All FoodBridge centers</option>';
  setMessage(message, '');
}

function startOperations(user) {
  currentAdmin = user;
  const version = ++sessionVersion;
  ['profiles', 'centers', 'listings', 'bookings'].forEach((name) => {
    const stop = onSnapshot(collection(db, name), (snapshot) => {
      if (version !== sessionVersion || currentAdmin?.uid !== user.uid) return;
      data[name] = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      loaded.add(name);
      failed.delete(name);
      render();
    }, (error) => {
      if (version !== sessionVersion || currentAdmin?.uid !== user.uid) return;
      failed.add(name);
      setMessage(message, `Could not load ${name}: ${errorMessage(error)}. Refresh and try again.`);
      render();
    });
    stops.push(stop);
  });
}

if (isConfigured && auth && db) {
  onAuthStateChanged(auth, (user) => {
    const version = ++authVersion;
    if (stopAccess) stopAccess();
    stopAccess = null;
    clearOperations();
    if (!user?.uid || !user.email) return;
    stopAccess = onSnapshot(doc(db, 'admins', user.uid), { includeMetadataChanges: true }, (snapshot) => {
      if (version !== authVersion) return;
      const record = snapshot.exists() ? snapshot.data() : null;
      // Never grant operational access based on stale offline admin data.
      if (snapshot.metadata.fromCache || record?.active !== true || record.email !== user.email) {
        clearOperations();
        return;
      }
      if (currentAdmin?.uid !== user.uid) startOperations(user);
    }, () => {
      if (version === authVersion) clearOperations();
    });
  });
}

const timeMs = (value) => value?.toMillis?.() || 0;
const sortNewest = (a, b) => timeMs(b.createdAt) - timeMs(a.createdAt);
const profileFor = (id) => data.profiles.find((item) => item.id === id);
const listingFor = (id) => data.listings.find((item) => item.id === id);
const bookingFor = (id) => data.bookings.find((item) => item.id === id);
const centerFor = (id) => data.centers.find((item) => item.id === id);
const addressFor = (profile) => [profile?.address, profile?.city].filter(Boolean).join(', ') || 'Not supplied; contact the business';

function foodState(item) {
  if (item.status === 'available' && timeMs(item.pickupBy) <= Date.now()) return 'expired';
  return item.status || 'unknown';
}

// Match the existing organization dashboard's active-center and expiry checks.
function visibleToOrganizations(item) {
  const center = centerFor(item.centerId);
  return item.status === 'available' && timeMs(item.pickupBy) > Date.now()
    && center?.active === true && center.type === 'foodbridge'
    && center.name === item.centerName && center.address === item.centerAddress
    && center.city === item.centerCity;
}

function updateCenterFilter(select) {
  const previous = select.value;
  const choices = new Map();
  data.centers.filter((center) => center.type === 'foodbridge').forEach((center) => {
    choices.set(center.id, `${center.name || 'Unnamed center'}${center.city ? `, ${center.city}` : ''}`);
  });
  [...data.listings, ...data.bookings].forEach((item) => {
    if (item.centerId && !choices.has(item.centerId)) {
      choices.set(item.centerId, `${item.centerName || 'Previous center'}${item.centerCity ? `, ${item.centerCity}` : ''}`);
    }
  });
  const options = [...choices.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  select.innerHTML = '<option value="all">All FoodBridge centers</option>'
    + options.map(([id, label]) => `<option value="${escapeHTML(id)}">${escapeHTML(label)}</option>`).join('');
  select.value = choices.has(previous) ? previous : 'all';
}

function render() {
  if (!currentAdmin) return;
  if (failed.size) {
    foodList.innerHTML = '<div class="notice error">Operations data could not be loaded. Refresh and try again.</div>';
    bookingList.innerHTML = '<div class="notice error">Operations data could not be loaded. Refresh and try again.</div>';
    countIds.forEach((id) => { $(id).textContent = '—'; });
    return;
  }
  if (loaded.size < 4) return;
  updateCenterFilter(foodCenter);
  updateCenterFilter(bookingCenter);
  $('ops-available-count').textContent = data.listings.filter(visibleToOrganizations).length;
  $('ops-booked-count').textContent = data.bookings.filter((item) => item.status === 'booked').length;
  $('ops-collected-count').textContent = data.bookings.filter((item) => item.status === 'collected').length;
  renderFoods();
  renderBookings();
}

function renderFoods() {
  const search = foodSearch.value.trim().toLowerCase();
  const matches = data.listings.filter((item) => {
    const booking = bookingFor(item.bookingId);
    const text = [item.title, item.restaurantName, item.category, item.centerName, item.centerCity, booking?.organizationName, item.id].join(' ').toLowerCase();
    return (foodStatus.value === 'all' || foodState(item) === foodStatus.value)
      && (foodCenter.value === 'all' || item.centerId === foodCenter.value)
      && text.includes(search);
  }).sort(sortNewest);
  if (!matches.length) {
    foodList.innerHTML = '<div class="empty-state">No food listings match these filters.</div>';
    return;
  }
  foodList.innerHTML = matches.map((item) => {
    const business = profileFor(item.restaurantId);
    const booking = bookingFor(item.bookingId);
    const state = foodState(item);
    const visibility = state === 'available'
      ? (visibleToOrganizations(item) ? 'Visible to approved organizations' : 'Not visible: center unavailable or details changed')
      : state === 'expired' ? 'Past the collection deadline' : '';
    const accountWarning = state === 'available' && business?.status !== 'approved'
      ? '<div class="notice mt-3">Restaurant approval is not active or could not be verified. New bookings are blocked by the rules.</div>' : '';
    const currentBooking = booking && item.status === 'booked'
      ? `<div class="notice info mt-3"><strong>Booked by ${escapeHTML(booking.organizationName)}</strong><p>Collector: ${escapeHTML(booking.contactName)} · ${escapeHTML(booking.contactPhone)}<br>Planned center pickup: ${escapeHTML(formatDate(booking.pickupAt))}<br>Organization transport: ${escapeHTML(booking.transport)}</p></div>`
      : item.status === 'booked' ? '<div class="notice mt-3">Booking details could not be matched. Check the booking record before making changes.</div>' : '';
    const withdraw = item.status === 'available'
      ? `<div class="card-actions"><button type="button" class="button button-danger button-small" data-ops-action="withdraw" data-id="${escapeHTML(item.id)}">Withdraw listing</button></div>` : '';
    return `<article class="data-card">${foodPhotoMarkup(item.imageUrl, item.title)}<div class="card-heading"><div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.quantity)} ${escapeHTML(item.unit)} · ${escapeHTML(item.category)}</p></div><span class="pill ${escapeHTML(state)}">${escapeHTML(state)}</span></div>${visibility ? `<p>${escapeHTML(visibility)}</p>` : ''}<div class="meta-grid"><div class="meta-item"><strong>Food business</strong>${escapeHTML(item.restaurantName)}<br>${escapeHTML(item.restaurantPhone)}</div><div class="meta-item"><strong>FoodBridge pickup from business</strong>${escapeHTML(addressFor(business))}${business?.contactName ? `<br>Contact: ${escapeHTML(business.contactName)}` : ''}</div><div class="meta-item"><strong>Deliver to FoodBridge center</strong>${escapeHTML(item.centerName)}<br>${escapeHTML(item.centerAddress)}, ${escapeHTML(item.centerCity)}</div><div class="meta-item"><strong>Organization pickup window</strong>${escapeHTML(formatDate(item.availableFrom))} – ${escapeHTML(formatDate(item.pickupBy))}</div><div class="meta-item"><strong>Prepared / packed</strong>${escapeHTML(formatDate(item.preparedAt))}</div><div class="meta-item"><strong>Listing ID</strong>${escapeHTML(item.id)}</div></div><p><strong>Food and ingredients:</strong> ${escapeHTML(item.description)}</p><p><strong>Allergens:</strong> ${escapeHTML(item.allergens)}</p><p><strong>Storage:</strong> ${escapeHTML(item.storageInstructions)}</p>${accountWarning}${currentBooking}${withdraw}</article>`;
  }).join('');
}

function renderBookings() {
  const search = bookingSearch.value.trim().toLowerCase();
  const matches = data.bookings.filter((item) => {
    const text = [item.listingTitle, item.organizationName, item.restaurantName, item.centerName, item.centerCity, item.contactName, item.id].join(' ').toLowerCase();
    return (bookingStatus.value === 'all' || item.status === bookingStatus.value)
      && (bookingCenter.value === 'all' || item.centerId === bookingCenter.value)
      && text.includes(search);
  }).sort(sortNewest);
  if (!matches.length) {
    bookingList.innerHTML = '<div class="empty-state">No bookings match these filters.</div>';
    return;
  }
  bookingList.innerHTML = matches.map((item) => {
    const listing = listingFor(item.listingId);
    const business = profileFor(item.restaurantId);
    const canManage = item.status === 'booked' && listing?.status === 'booked'
      && listing.bookingId === item.id && listing.bookedBy === item.organizationId;
    const actions = canManage
      ? `<div class="card-actions"><button type="button" class="button button-primary button-small" data-ops-action="collect" data-id="${escapeHTML(item.id)}">Confirm organization collected</button><button type="button" class="button button-danger button-small" data-ops-action="cancel" data-id="${escapeHTML(item.id)}">Cancel booking & withdraw food</button></div>`
      : item.status === 'booked' ? '<div class="notice mt-3">The linked listing could not be matched. Coordinate this booking manually.</div>' : '';
    return `<article class="data-card">${foodPhotoMarkup(item.imageUrl || listing?.imageUrl, item.listingTitle)}<div class="card-heading"><div><h3>${escapeHTML(item.listingTitle)}</h3><p>${escapeHTML(item.quantity)} ${escapeHTML(item.unit)} · booked by ${escapeHTML(item.organizationName)}</p></div><span class="pill ${escapeHTML(item.status)}">${escapeHTML(item.status)}</span></div><div class="meta-grid"><div class="meta-item"><strong>Food business</strong>${escapeHTML(item.restaurantName)} · ${escapeHTML(item.restaurantPhone)}</div><div class="meta-item"><strong>FoodBridge pickup from business</strong>${escapeHTML(addressFor(business))}</div><div class="meta-item"><strong>Pickup center</strong>${escapeHTML(item.centerName)}<br>${escapeHTML(item.centerAddress)}, ${escapeHTML(item.centerCity)}</div><div class="meta-item"><strong>Planned organization pickup</strong>${escapeHTML(formatDate(item.pickupAt))}</div><div class="meta-item"><strong>Organization collector</strong>${escapeHTML(item.contactName)} · ${escapeHTML(item.contactPhone)}</div><div class="meta-item"><strong>Organization transport</strong>${escapeHTML(item.transport)}</div><div class="meta-item"><strong>Booking ID</strong>${escapeHTML(item.id)}</div></div>${item.notes ? `<p><strong>Collection notes:</strong> ${escapeHTML(item.notes)}</p>` : ''}${actions}</article>`;
  }).join('');
}

[foodSearch, bookingSearch].forEach((input) => input.addEventListener('input', render));
[foodStatus, foodCenter, bookingStatus, bookingCenter].forEach((input) => input.addEventListener('change', render));
window.setInterval(render, 60000);

async function performAction(event) {
  const button = event.target.closest('[data-ops-action]');
  if (!button || !currentAdmin || actionBusy) return;
  const action = button.dataset.opsAction;
  const id = button.dataset.id;
  const confirmation = action === 'withdraw'
    ? 'Withdraw this unbooked food listing? It will no longer be available to organizations.'
    : action === 'collect'
      ? 'Confirm that the organization has physically collected this food from the FoodBridge center?'
      : 'Cancel this booking AND withdraw the food listing? Contact the organization and restaurant separately; the app does not send a notification.';
  if (!window.confirm(confirmation)) return;
  actionBusy = true;
  setMessage(message, '');
  busy(button, true, 'Saving…');
  try {
    if (action === 'withdraw') {
      const listingRef = doc(db, 'listings', id);
      await runTransaction(db, async (transaction) => {
        const listing = await transaction.get(listingRef);
        if (!listing.exists() || listing.data().status !== 'available') throw new Error('This listing is no longer available to withdraw. Refresh and try again.');
        transaction.update(listingRef, { status: 'cancelled', updatedAt: serverTimestamp() });
      });
      setMessage(message, 'The food listing was withdrawn.', 'success');
    } else if (action === 'collect' || action === 'cancel') {
      const bookingRef = doc(db, 'bookings', id);
      await runTransaction(db, async (transaction) => {
        const booking = await transaction.get(bookingRef);
        if (!booking.exists() || booking.data().status !== 'booked') throw new Error('This booking is no longer active. Refresh and try again.');
        const item = booking.data();
        const listingRef = doc(db, 'listings', item.listingId);
        const listing = await transaction.get(listingRef);
        if (!listing.exists() || listing.data().status !== 'booked'
          || listing.data().bookingId !== booking.id || listing.data().bookedBy !== item.organizationId) {
          throw new Error('The booking and listing no longer match. Refresh and coordinate them manually.');
        }
        if (action === 'collect') {
          transaction.update(bookingRef, { status: 'collected', updatedAt: serverTimestamp() });
          transaction.update(listingRef, { status: 'collected', updatedAt: serverTimestamp() });
        } else {
          transaction.update(bookingRef, { status: 'cancelled', updatedAt: serverTimestamp() });
          transaction.update(listingRef, { status: 'cancelled', bookedBy: '', bookingId: '', updatedAt: serverTimestamp() });
        }
      });
      setMessage(message, action === 'collect' ? 'Organization collection was confirmed.' : 'The booking was cancelled and the listing withdrawn. Please notify both parties.', 'success');
    }
  } catch (error) {
    setMessage(message, errorMessage(error));
  } finally {
    busy(button, false);
    actionBusy = false;
  }
}
foodList.addEventListener('click', performAction);
bookingList.addEventListener('click', performAction);
