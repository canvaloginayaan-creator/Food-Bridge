import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A small in-memory SDK double exercises the actual page handlers without a
// Firebase project. It is NOT a substitute for the separate emulator rules tests.
const fake = vi.hoisted(() => ({ docs: new Map(), subscriptions: new Set(), authSubscriptions: new Set(), authSynchronous: false, fromCache: false, user: null, writes: [], nextId: 0, notify: () => {}, stamp: null }));
vi.mock('../src/firebase.js', () => ({ isConfigured: true, auth: {}, db: {}, googleProvider: {}, errorMessage: (error) => error.message || 'Error' }));
vi.mock('../src/model.js', async (importOriginal) => ({ ...(await importOriginal()), dashboardFor: () => '#account' }));
vi.mock('firebase/auth', () => {
  const emit = () => { for (const callback of fake.authSubscriptions) queueMicrotask(() => callback(fake.user)); };
  return {
    onAuthStateChanged: (_auth, callback) => { fake.authSubscriptions.add(callback); if (fake.authSynchronous) callback(fake.user); else queueMicrotask(() => { if (fake.authSubscriptions.has(callback)) callback(fake.user); }); return () => fake.authSubscriptions.delete(callback); },
    createUserWithEmailAndPassword: vi.fn(async (_auth, email) => { fake.user = { uid: 'new-user', email }; emit(); return { user: fake.user }; }),
    signInWithPopup: vi.fn(async () => { fake.user = { uid: 'google-user', email: 'google@example.com', displayName: 'Google Person' }; emit(); return { user: fake.user }; }),
    signInWithEmailAndPassword: vi.fn(async (_auth, email) => { fake.user = { uid: 'signed-in', email }; emit(); return { user: fake.user }; }),
    signOut: vi.fn(async () => { fake.user = null; emit(); }),
    sendPasswordResetEmail: vi.fn(async () => {})
  };
});
vi.mock('firebase/firestore', () => {
  class MockTimestamp {
    constructor(date) { this.date = new Date(date); }
    toDate() { return new Date(this.date); }
    toMillis() { return this.date.getTime(); }
    static fromDate(date) { return new MockTimestamp(date); }
  }
  fake.stamp = (value) => MockTimestamp.fromDate(new Date(value));
  const collection = (_db, name) => ({ kind: 'collection', name });
  const doc = (parent, name, id) => parent?.kind === 'collection'
    ? { kind: 'doc', name: parent.name, id: name || `generated-${++fake.nextId}` }
    : { kind: 'doc', name, id };
  const key = (reference) => `${reference.name}/${reference.id}`;
  const snapshot = (reference) => {
    if (reference.kind === 'doc') {
      const data = fake.docs.get(key(reference));
      return { id: reference.id, exists: () => data !== undefined, data: () => data, metadata: { fromCache: fake.fromCache } };
    }
    const base = reference.kind === 'query' ? reference.collection : reference;
    const filters = reference.filters || [];
    const docs = [...fake.docs.entries()].filter(([entry, data]) => entry.startsWith(`${base.name}/`) && filters.every((filter) => data[filter.field] === filter.value))
      .map(([entry, data]) => ({ id: entry.slice(base.name.length + 1), exists: () => true, data: () => data }));
    return { docs };
  };
  fake.notify = () => { for (const subscription of fake.subscriptions) queueMicrotask(() => { if (fake.subscriptions.has(subscription)) subscription.callback(snapshot(subscription.reference)); }); };
  const save = (reference, value, merge = false) => {
    fake.docs.set(key(reference), merge ? { ...fake.docs.get(key(reference)), ...value } : value);
    fake.writes.push({ reference, value, merge });
  };
  return {
    collection, doc,
    query: (ref, ...filters) => ({ kind: 'query', collection: ref, filters }),
    where: (field, _operator, value) => ({ field, value }),
    getDoc: vi.fn(async (reference) => snapshot(reference)),
    getDocs: vi.fn(async (reference) => snapshot(reference)),
    onSnapshot: (reference, optionsOrCallback, next) => { const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : next; const sub = { reference, callback }; fake.subscriptions.add(sub); queueMicrotask(() => { if (fake.subscriptions.has(sub)) callback(snapshot(reference)); }); return () => fake.subscriptions.delete(sub); },
    serverTimestamp: () => MockTimestamp.fromDate(new Date()),
    Timestamp: MockTimestamp,
    setDoc: vi.fn(async (reference, value) => { save(reference, value); fake.notify(); }),
    updateDoc: vi.fn(async (reference, value) => { save(reference, value, true); fake.notify(); }),
    runTransaction: vi.fn(async (_db, callback) => {
      const pending = [];
      const transaction = { get: async (reference) => snapshot(reference), set: (reference, value) => pending.push([reference, value, false]), update: (reference, value) => pending.push([reference, value, true]) };
      const result = await callback(transaction);
      pending.forEach(([reference, value, merge]) => save(reference, value, merge));
      fake.notify(); return result;
    })
  };
});
function load(file, url) {
  window.history.replaceState({}, '', url);
  const parsed = new DOMParser().parseFromString(readFileSync(resolve(process.cwd(), file), 'utf8'), 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}
function fill(id, value) { document.getElementById(id).value = value; }
function submit(id) { document.getElementById(id).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
const wait = (condition) => vi.waitFor(() => expect(condition()).toBeTruthy(), { timeout: 2500 });
const profile = (role, status = 'approved') => ({ role, status, name: role === 'organization' ? 'Helping Hands' : 'Good Kitchen', contactName: 'Contact Person', phone: '03001234567', city: 'Karachi' });
const signInAdmin = () => { fake.user = { uid: 'admin', email: 'admin@example.com' }; fake.docs.set('admins/admin', { active: true, email: 'admin@example.com' }); };
const center = () => ({ name: 'Center One', type: 'foodbridge', city: 'Karachi', address: 'Confirmed address', hours: '12 to 4', phone: '', mapUrl: '', active: true });
const local = (milliseconds) => { const d = new Date(milliseconds); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

beforeEach(() => {
  vi.resetModules(); fake.docs.clear(); fake.subscriptions.clear(); fake.authSubscriptions.clear(); fake.writes.length = 0; fake.user = null; fake.authSynchronous = false; fake.fromCache = false; fake.nextId = 0;
  document.body.innerHTML = '';
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});

it('unsubscribes correctly even when an auth observer calls back synchronously', async () => {
  fake.user = { uid: 'person', email: 'person@example.com' };
  fake.authSynchronous = true;
  const { currentUser } = await import('../src/session.js');
  expect(await currentUser()).toEqual(fake.user);
  expect(fake.authSubscriptions.size).toBe(0);
});

describe('registration and role-specific workflows with a mocked Firebase SDK', () => {
  it('creates an individual account once and saves a pending profile without business evidence', async () => {
    load('register.html', '/register.html?role=individual');
    await import('../src/pages/register.js');
    await wait(() => !document.getElementById('register-submit').disabled);
    fill('register-email', 'person@example.com'); fill('register-password', 'password123'); fill('register-name', 'A Person'); fill('register-phone', '03001234567'); fill('register-city', 'Karachi');
    document.getElementById('register-consent').checked = true;
    submit('register-form');
    await wait(() => fake.docs.has('profiles/new-user'));
    expect(fake.docs.get('profiles/new-user')).toMatchObject({ uid: 'new-user', email: 'person@example.com', role: 'individual', status: 'pending', address: '', website: '', evidenceUrls: [] });
  });
  it('accepts Google sign-in before completing an organization application', async () => {
    load('register.html', '/register.html?role=organization');
    await import('../src/pages/register.js');
    await wait(() => !document.getElementById('register-submit').disabled);
    document.getElementById('google-register').click();
    await wait(() => !document.getElementById('signed-account').hidden);
    await wait(() => !document.getElementById('register-submit').disabled);
    fill('register-name', 'Helping Hands'); fill('register-contact', 'Ali Khan'); fill('register-phone', '03001234567'); fill('register-city', 'Karachi'); fill('register-address', 'Main Road'); fill('register-website', 'https://example.org'); fill('register-description', 'We provide meals.');
    document.getElementById('register-consent').checked = true;
    submit('register-form');
    await wait(() => fake.docs.has('profiles/google-user'));
    expect(fake.docs.get('profiles/google-user')).toMatchObject({ uid: 'google-user', email: 'google@example.com', role: 'organization', status: 'pending', website: 'https://example.org/' });
  });
  it('saves external photo/video links for restaurant verification without uploading files', async () => {
    load('register.html', '/register.html?role=restaurant');
    await import('../src/pages/register.js');
    await wait(() => !document.getElementById('register-submit').disabled);
    fill('register-email', 'restaurant@example.com'); fill('register-password', 'password123'); fill('register-name', 'Good Kitchen'); fill('register-contact', 'Ali'); fill('register-phone', '03001234567'); fill('register-city', 'Karachi'); fill('register-address', 'Main Road'); fill('register-description', 'We prepare food.');
    fill('register-evidence', 'https://example.com/photo.jpg\nhttps://example.com/video');
    document.getElementById('register-consent').checked = true;
    submit('register-form');
    await wait(() => fake.docs.has('profiles/new-user'));
    expect(fake.docs.get('profiles/new-user').evidenceUrls).toEqual(['https://example.com/photo.jpg', 'https://example.com/video']);
    expect(fake.docs.get('profiles/new-user')).not.toHaveProperty('evidencePaths');
  });
  it('rejects unsafe verification URLs before creating an account', async () => {
    load('register.html', '/register.html?role=restaurant');
    await import('../src/pages/register.js');
    await wait(() => !document.getElementById('register-submit').disabled);
    fill('register-email', 'restaurant@example.com'); fill('register-password', 'password123'); fill('register-name', 'Good Kitchen'); fill('register-contact', 'Ali'); fill('register-phone', '03001234567'); fill('register-city', 'Karachi'); fill('register-address', 'Main Road'); fill('register-description', 'We prepare food.');
    fill('register-evidence', 'javascript:alert(1)'); document.getElementById('register-consent').checked = true;
    submit('register-form');
    expect(document.getElementById('register-message').textContent).toMatch(/valid http/i);
    expect(fake.user).toBeNull();
  });
  it('reopens a rejected organization application without changing its role or account', async () => {
    fake.user = { uid: 'org1', email: 'org1@example.com' };
    fake.docs.set('profiles/org1', { ...profile('organization', 'rejected'), uid: 'org1', email: 'org1@example.com', address: 'Old Address', website: 'https://example.org/', description: 'Our work', evidenceUrls: [], createdAt: { toDate: () => new Date('2026-01-01'), toMillis: () => 1767225600000 }, reviewNote: 'Please update your address' });
    load('register.html', '/register.html?edit=1');
    await import('../src/pages/register.js');
    await wait(() => document.getElementById('register-heading').textContent === 'Update your application');
    expect(document.querySelector('input[name=role]:checked').value).toBe('organization');
    expect(document.querySelector('input[name=role][value=restaurant]').disabled).toBe(true);
    fill('register-address', 'Updated address');
    document.getElementById('register-consent').checked = true;
    submit('register-form');
    await wait(() => fake.docs.get('profiles/org1').status === 'pending');
    expect(fake.docs.get('profiles/org1')).toMatchObject({ role: 'organization', uid: 'org1', address: 'Updated address', reviewNote: '' });
  });
  it('lets a rejected legacy applicant replace unavailable uploads with URLs', async () => {
    fake.user = { uid: 'org1', email: 'org1@example.com' };
    fake.docs.set('profiles/org1', { ...profile('organization', 'rejected'), uid: 'org1', email: 'org1@example.com', address: 'Address', website: '', description: 'Our work', evidencePaths: ['verification/org1/old.jpg'], createdAt: { toDate: () => new Date('2026-01-01'), toMillis: () => 1767225600000 }, reviewNote: 'Please add a link' });
    load('register.html', '/register.html?edit=1');
    await import('../src/pages/register.js');
    await wait(() => document.getElementById('register-heading').textContent === 'Update your application');
    expect(document.getElementById('evidence-help').textContent).toMatch(/previous uploads/i);
    fill('register-evidence', 'https://example.org/new-photo');
    document.getElementById('register-consent').checked = true;
    submit('register-form');
    await wait(() => fake.docs.get('profiles/org1').status === 'pending');
    expect(fake.docs.get('profiles/org1').evidenceUrls).toEqual(['https://example.org/new-photo']);
    expect(fake.docs.get('profiles/org1')).not.toHaveProperty('evidencePaths');
  });
  it('shows safe verification links in the admin workspace without injecting unsafe URLs', async () => {
    signInAdmin();
    fake.docs.set('profiles/org1', { ...profile('organization', 'pending'), uid: 'org1', email: 'org1@example.com', address: 'Address', website: '', description: 'Our work', evidenceUrls: ['https://example.com/photo.jpg', 'javascript:alert(1)'], createdAt: { toDate: () => new Date(), toMillis: () => Date.now() } });
    load('admin-dashboard.html', '/admin-dashboard.html');
    await import('../src/pages/admin.js');
    await wait(() => document.querySelector('.evidence-link'));
    const links = document.querySelectorAll('.evidence-link');
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe('https://example.com/photo.jpg');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[0].target).toBe('_blank');
  });
  it('does not expose restaurant tools to an individual even through a direct URL', async () => {
    fake.user = { uid: 'person', email: 'person@example.com' };
    fake.docs.set('profiles/person', { ...profile('individual', 'pending'), name: 'A Person' });
    load('donor-dashboard.html', '/donor-dashboard.html');
    await import('../src/pages/donor.js');
    await wait(() => document.getElementById('access-state').textContent.includes('different account type'));
    expect(document.getElementById('protected-content').hidden).toBe(true);
    expect(document.getElementById('donor-action').hidden).toBe(true);
  });
  it('lets an approved restaurant publish a real listing and confirm collection', async () => {
    fake.user = { uid: 'restaurant', email: 'restaurant@example.com' };
    fake.docs.set('profiles/restaurant', profile('restaurant'));
    fake.docs.set('centers/center1', center());
    load('donor-dashboard.html', '/donor-dashboard.html');
    await import('../src/pages/donor.js');
    await wait(() => !document.getElementById('listing-submit').disabled);
    fill('food-title', 'Rice'); fill('food-category', 'Prepared meal'); fill('food-quantity', '12'); fill('food-unit', 'boxes'); fill('food-center', 'center1');
    fill('food-prepared', local(Date.now() - 3600000)); fill('food-start', local(Date.now() + 600000)); fill('food-deadline', local(Date.now() + 7200000)); fill('food-description', 'Rice and vegetables'); fill('food-allergens', 'Unknown'); fill('food-storage', 'Keep chilled'); document.getElementById('food-confirm').checked = true;
    submit('listing-form');
    await wait(() => [...fake.docs.keys()].some((key) => key.startsWith('listings/')));
    const listingKey = [...fake.docs.keys()].find((key) => key.startsWith('listings/'));
    const listingId = listingKey.split('/')[1];
    expect(fake.docs.get(listingKey)).toMatchObject({ restaurantId: 'restaurant', status: 'available', centerId: 'center1', quantity: 12 });
    fake.docs.set(listingKey, { ...fake.docs.get(listingKey), status: 'booked', bookingId: 'booking1', bookedBy: 'org1' });
    fake.docs.set('bookings/booking1', { listingId, restaurantId: 'restaurant', organizationName: 'Helping Hands', status: 'booked', pickupAt: fake.stamp(Date.now() + 1800000), contactName: 'Collector', contactPhone: '03001234567', transport: 'Car' });
    fake.notify();
    await wait(() => document.querySelector('[data-action=collect]'));
    document.querySelector('[data-action=collect]').click();
    await wait(() => fake.docs.get(listingKey).status === 'collected');
    expect(fake.docs.get('bookings/booking1').status).toBe('collected');
  });
  it('books and cancels a full pickup for an approved organization', async () => {
    fake.user = { uid: 'org1', email: 'org1@example.com' };
    fake.docs.set('profiles/org1', profile('organization'));
    fake.docs.set('centers/center1', center());
    fake.docs.set('listings/food1', { restaurantId: 'restaurant', restaurantName: 'Good Kitchen', restaurantPhone: '03001234567', title: 'Rice', category: 'Prepared meal', quantity: 12, unit: 'boxes', description: 'Rice', allergens: 'Unknown', storageInstructions: 'Keep chilled', preparedAt: { toDate: () => new Date(Date.now() - 3600000), toMillis: () => Date.now() - 3600000 }, availableFrom: { toDate: () => new Date(Date.now() - 600000), toMillis: () => Date.now() - 600000 }, pickupBy: { toDate: () => new Date(Date.now() + 7200000), toMillis: () => Date.now() + 7200000 }, centerId: 'center1', centerName: 'Center One', centerAddress: 'Confirmed address', centerCity: 'Karachi', status: 'available', bookedBy: '', bookingId: '' });
    load('receiver-dashboard.html', '/receiver-dashboard.html');
    await import('../src/pages/receiver.js');
    await wait(() => document.querySelector('[data-book="food1"]'));
    document.querySelector('[data-book="food1"]').click();
    expect(document.getElementById('booking-dialog').open).toBe(true);
    fill('pickup-name', 'Collector'); fill('pickup-phone', '03001234567'); fill('pickup-time', local(Date.now() + 1800000)); fill('pickup-transport', 'Volunteer car');
    document.getElementById('pickup-confirm').checked = true;
    submit('booking-form');
    await wait(() => fake.docs.get('listings/food1').status === 'booked');
    const bookingId = fake.docs.get('listings/food1').bookingId;
    expect(fake.docs.get(`bookings/${bookingId}`)).toMatchObject({ organizationId: 'org1', listingId: 'food1', selfPickup: true, status: 'booked', transport: 'Volunteer car', restaurantPhone: '03001234567', quantity: 12, unit: 'boxes' });
    await wait(() => document.querySelector(`[data-cancel="${bookingId}"]`));
    document.querySelector(`[data-cancel="${bookingId}"]`).click();
    await wait(() => fake.docs.get('listings/food1').status === 'available');
    expect(fake.docs.get(`bookings/${bookingId}`).status).toBe('cancelled');
  });
  it('shows all food, origin, bookings and center filters to the admin and clears data on revocation', async () => {
    signInAdmin();
    fake.docs.set('profiles/restaurant', { ...profile('restaurant'), address: 'Business Street' });
    fake.docs.set('profiles/org1', profile('organization'));
    fake.docs.set('centers/center1', center());
    const stamp = fake.stamp;
    const food = { title: 'Rice <img src=x onerror=alert(1)>', category: 'Prepared meal', quantity: 12, unit: 'boxes', description: 'Rice', allergens: 'None known', storageInstructions: 'Chilled', restaurantId: 'restaurant', restaurantName: 'Good Kitchen', restaurantPhone: '03001234567', centerId: 'center1', centerName: 'Center One', centerAddress: 'Confirmed address', centerCity: 'Karachi', status: 'available', bookedBy: '', bookingId: '', createdAt: stamp(Date.now()), availableFrom: stamp(Date.now()-600000), pickupBy: stamp(Date.now()+7200000), preparedAt: stamp(Date.now()-3600000), imageUrl: 'https://example.org/rice.jpg' };
    fake.docs.set('listings/food1', food);
    fake.docs.set('listings/food2', { ...food, title: 'Booked food', status: 'booked', bookedBy: 'org1', bookingId: 'booking1' });
    fake.docs.set('bookings/booking1', { listingId: 'food2', listingTitle: 'Booked food', organizationId: 'org1', organizationName: 'Helping Hands', restaurantId: 'restaurant', restaurantName: 'Good Kitchen', restaurantPhone: '03001234567', centerId: 'center1', centerName: 'Center One', centerAddress: 'Confirmed address', centerCity: 'Karachi', contactName: 'Collector', contactPhone: '03001234567', transport: 'Car', quantity: 12, unit: 'boxes', pickupAt: stamp(Date.now()+3600000), createdAt: stamp(Date.now()), status: 'booked' });
    load('admin-dashboard.html', '/admin-dashboard.html');
    await import('../src/pages/admin.js'); await import('../src/pages/admin-operations.js');
    await wait(() => document.getElementById('ops-food-list').textContent.includes('Booked food'));
    expect(document.getElementById('ops-food-list').textContent).toContain('Business Street');
    expect(document.getElementById('ops-booking-list').textContent).toContain('Helping Hands');
    expect(document.getElementById('ops-booking-list').textContent).toContain('Center One');
    expect(document.getElementById('ops-available-count').textContent).toBe('1');
    expect(document.querySelector('#ops-food-list img[src=x]')).toBeNull();
    document.getElementById('tab-foods').click();
    expect(document.getElementById('food-ops-panel').hidden).toBe(false);
    expect(document.getElementById('applications-panel').hidden).toBe(true);
    document.getElementById('tab-centers').click();
    expect(document.getElementById('food-ops-panel').hidden).toBe(true);
    expect(document.getElementById('centers-panel').hidden).toBe(false);
    document.getElementById('ops-booking-center').value = 'center1';
    document.getElementById('ops-booking-center').dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.getElementById('ops-booking-list').textContent).toContain('Booked food');
    document.querySelector('[data-ops-action=collect]').click();
    await wait(() => fake.docs.get('bookings/booking1').status === 'collected');
    expect(fake.docs.get('listings/food2').status).toBe('collected');
    fake.docs.set('admins/admin', { active: false, email: 'admin@example.com' }); fake.notify();
    await wait(() => document.getElementById('admin-content').hidden);
    expect(document.getElementById('ops-food-list').textContent).not.toContain('Business Street');
    expect(document.getElementById('ops-booking-list').textContent).not.toContain('Helping Hands');
  });
  it('shows pending individuals locations without food-sharing tools', async () => {
    fake.user = { uid: 'person', email: 'person@example.com' };
    fake.docs.set('profiles/person', { ...profile('individual', 'pending'), name: 'A Person' });
    fake.docs.set('centers/center1', center());
    load('centers.html', '/centers.html');
    await import('../src/pages/centers.js');
    await wait(() => document.getElementById('centers-list').textContent.includes('Center One'));
    expect(document.getElementById('individual-status').textContent).toMatch(/registration is complete/i);
    expect(document.querySelector('#site-header').textContent).not.toMatch(/donate|share food|available food|admin/i);
  });
  it.each([
    ['no record', null, 'person@example.com'],
    ['inactive record', { active: false, email: 'person@example.com' }, 'person@example.com'],
    ['string instead of Boolean', { active: 'true', email: 'person@example.com' }, 'person@example.com'],
    ['wrong email', { active: true, email: 'different@example.com' }, 'person@example.com'],
    ['missing email', { active: true }, 'person@example.com'],
    ['no authenticated email', { active: true, email: 'person@example.com' }, null]
  ])('denies administrator access with %s even if the user has an old claim', async (_label, record, email) => {
    fake.user = { uid: 'person', email, getIdTokenResult: async () => ({ claims: { admin: true } }) };
    if (record) fake.docs.set('admins/person', record);
    fake.docs.set('admins/someone-else', { active: true, email: 'person@example.com' });
    load('admin-dashboard.html', '/admin-dashboard.html');
    await import('../src/pages/admin.js');
    await wait(() => !document.getElementById('admin-denied').hidden);
    expect(document.getElementById('admin-content').hidden).toBe(true);
  });
  it('grants and revokes an authenticated admin immediately when the matching record changes', async () => {
    fake.user = { uid: 'person', email: 'person@example.com' };
    fake.docs.set('profiles/private', { ...profile('organization', 'pending'), uid: 'private', email: 'private@example.com' });
    load('admin-dashboard.html', '/admin-dashboard.html');
    await import('../src/pages/admin.js');
    await wait(() => !document.getElementById('admin-denied').hidden);
    fake.docs.set('admins/person', { active: true, email: 'person@example.com' }); fake.notify();
    await wait(() => !document.getElementById('admin-content').hidden);
    await wait(() => document.getElementById('admin-applications').textContent.includes('Helping Hands'));
    fake.docs.set('admins/person', { active: false, email: 'person@example.com' }); fake.notify();
    await wait(() => !document.getElementById('admin-denied').hidden);
    expect(document.getElementById('admin-content').hidden).toBe(true);
    expect(document.getElementById('admin-applications').textContent).not.toContain('Helping Hands');
    expect(fake.subscriptions.size).toBe(1); // only the user's own admin record remains watched
  });
  it('does not grant admin access from an offline cached record', async () => {
    signInAdmin(); fake.fromCache = true;
    load('admin-dashboard.html', '/admin-dashboard.html');
    await import('../src/pages/admin.js');
    await wait(() => !document.getElementById('admin-denied').hidden);
    expect(document.getElementById('admin-denied').textContent).toMatch(/connection/i);
    expect(document.getElementById('admin-content').hidden).toBe(true);
    fake.fromCache = false; fake.notify();
    await wait(() => !document.getElementById('admin-content').hidden);
  });
  it('withdraws available listings when an administrator requests changes from an approved restaurant', async () => {
    signInAdmin();
    fake.docs.set('profiles/restaurant', { ...profile('restaurant'), uid: 'restaurant', email: 'restaurant@example.com', address: 'Address', website: 'https://example.org', description: 'Our work', evidenceUrls: [], createdAt: { toDate: () => new Date(), toMillis: () => Date.now() } });
    fake.docs.set('listings/food1', { restaurantId: 'restaurant', status: 'available' });
    fake.docs.set('listings/food2', { restaurantId: 'restaurant', status: 'booked' });
    load('admin-dashboard.html', '/admin-dashboard.html');
    await import('../src/pages/admin.js');
    await wait(() => !document.getElementById('admin-content').hidden);
    document.getElementById('filter-status').value = 'all';
    document.getElementById('filter-status').dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => document.querySelector('[data-review=rejected]'));
    fill('note-restaurant', 'Please update your verification.');
    document.querySelector('[data-review=rejected]').click();
    await wait(() => fake.docs.get('listings/food1').status === 'cancelled');
    expect(fake.docs.get('profiles/restaurant').status).toBe('rejected');
    expect(fake.docs.get('listings/food2').status).toBe('booked');
  });
  it('lets a Firestore-authorized administrator review a pending application', async () => {
    signInAdmin();
    fake.docs.set('profiles/org1', { ...profile('organization', 'pending'), uid: 'org1', email: 'org1@example.com', address: 'Address', website: 'https://example.org', description: 'Our work', evidenceUrls: [], createdAt: { toDate: () => new Date(), toMillis: () => Date.now() } });
    load('admin-dashboard.html', '/admin-dashboard.html');
    await import('../src/pages/admin.js');
    await wait(() => document.querySelector('[data-review=approved]'));
    document.querySelector('[data-review=approved]').click();
    await wait(() => fake.docs.get('profiles/org1').status === 'approved');
    expect(fake.docs.get('profiles/org1').reviewedBy).toBe('admin');
  });
});
