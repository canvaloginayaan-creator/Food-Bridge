// @vitest-environment node
// Designed for the official Firestore emulator (see README); compatible third-party
// emulators may also run them. Skipped without FIRESTORE_EMULATOR_HOST.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const projectId = 'demo-foodbridge-pk';
let env;
const now = () => Date.now();
const ts = (delta) => Timestamp.fromMillis(now() + delta);
const userProfile = (uid, role, status = 'approved') => ({
  uid, role, status, name: uid.toUpperCase(), contactName: `${uid} contact`, email: `${uid}@example.com`,
  phone: '03001234567', city: 'Karachi', address: role === 'individual' ? '' : 'Verified address',
  website: role === 'individual' ? '' : 'https://example.com/', description: role === 'individual' ? '' : 'Our work',
  evidenceUrls: [], createdAt: ts(-86400000), consentAt: ts(-86400000), updatedAt: ts(-86400000), reviewedAt: null, reviewedBy: '', reviewNote: ''
});
const centerData = () => ({ name: 'Confirmed Center', type: 'foodbridge', city: 'Karachi', address: 'Confirmed address', hours: '12–5 pm', phone: '', mapUrl: '', active: true, createdAt: ts(-86400000), updatedAt: ts(-86400000) });
const listingData = () => ({
  restaurantId: 'restaurant', restaurantName: 'RESTAURANT', restaurantPhone: '03001234567',
  title: 'Rice', category: 'Prepared meal', quantity: 12, unit: 'boxes', description: 'Rice and vegetables', allergens: 'Unknown', storageInstructions: 'Keep chilled',
  preparedAt: ts(-3600000), availableFrom: ts(-600000), pickupBy: ts(7200000),
  centerId: 'center', centerName: 'Confirmed Center', centerAddress: 'Confirmed address', centerCity: 'Karachi',
  status: 'available', bookedBy: '', bookingId: '', createdAt: ts(-600000), updatedAt: ts(-600000)
});
const dbFor = (uid, claims = {}) => env.authenticatedContext(uid, { email: `${uid}@example.com`, ...claims }).firestore();
const bookingData = (uid, item) => ({
  listingId: 'food', listingTitle: item.title, restaurantId: item.restaurantId, restaurantName: item.restaurantName, restaurantPhone: item.restaurantPhone, quantity: item.quantity, unit: item.unit,
  organizationId: uid, organizationName: uid.toUpperCase(), centerId: item.centerId, centerName: item.centerName,
  centerAddress: item.centerAddress, centerCity: item.centerCity, contactName: 'Collector', contactPhone: '03001234567',
  transport: 'Volunteer car', notes: '', pickupAt: ts(1800000), selfPickup: true, status: 'booked',
  createdAt: serverTimestamp(), updatedAt: serverTimestamp()
});
async function reserve(db, uid, bookingId) {
  const listing = doc(db, 'listings', 'food');
  const booking = doc(db, 'bookings', bookingId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(listing);
    if (!snap.exists() || snap.data().status !== 'available') throw new Error('Already booked');
    tx.set(booking, bookingData(uid, snap.data()));
    tx.update(listing, { status: 'booked', bookedBy: uid, bookingId, updatedAt: serverTimestamp() });
  });
}
async function cancel(db, bookingId) {
  const listing = doc(db, 'listings', 'food');
  const booking = doc(db, 'bookings', bookingId);
  return runTransaction(db, async (tx) => {
    await Promise.all([tx.get(listing), tx.get(booking)]);
    tx.update(booking, { status: 'cancelled', updatedAt: serverTimestamp() });
    tx.update(listing, { status: 'available', bookedBy: '', bookingId: '', updatedAt: serverTimestamp() });
  });
}
async function collect(db, bookingId) {
  const listing = doc(db, 'listings', 'food');
  const booking = doc(db, 'bookings', bookingId);
  return runTransaction(db, async (tx) => {
    await Promise.all([tx.get(listing), tx.get(booking)]);
    tx.update(listing, { status: 'collected', updatedAt: serverTimestamp() });
    tx.update(booking, { status: 'collected', updatedAt: serverTimestamp() });
  });
}

emulatorDescribe('Firestore security rules (emulator)', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync(resolve('firestore.rules'), 'utf8') } });
  });
  afterAll(async () => { await env?.cleanup(); });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        ...[['restaurant', 'restaurant', 'approved'], ['org1', 'organization', 'approved'], ['org2', 'organization', 'approved'], ['pendingorg', 'organization', 'pending'], ['individual', 'individual', 'pending']].map(([uid, role, status]) => setDoc(doc(db, 'profiles', uid), userProfile(uid, role, status))),
        setDoc(doc(db, 'admins', 'admin'), { active: true, email: 'admin@example.com' }),
        setDoc(doc(db, 'centers', 'center'), centerData()),
        setDoc(doc(db, 'listings', 'food'), listingData())
      ]);
    });
  });
  it('lets users read only their own admin record and prevents all client-side admin grants', async () => {
    const admin = dbFor('admin'); const regular = dbFor('org1');
    await assertSucceeds(getDoc(doc(admin, 'admins', 'admin')));
    await assertSucceeds(getDoc(doc(regular, 'admins', 'org1'))); // even an absent record may be checked
    await assertFails(getDoc(doc(regular, 'admins', 'admin')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'admins', 'admin')));
    await assertFails(getDocs(collection(admin, 'admins')));
    await assertFails(setDoc(doc(regular, 'admins', 'org1'), { active: true, email: 'org1@example.com' }));
    await assertFails(setDoc(doc(admin, 'admins', 'other'), { active: true, email: 'other@example.com' }));
    await assertFails(updateDoc(doc(admin, 'admins', 'admin'), { active: false }));
    await assertFails(deleteDoc(doc(admin, 'admins', 'admin')));
  });
  it('requires the correct UID, an active Boolean and the exact authenticated email', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, 'admins', 'inactive'), { active: false, email: 'inactive@example.com' }),
        setDoc(doc(db, 'admins', 'mismatch'), { active: true, email: 'other@example.com' }),
        setDoc(doc(db, 'admins', 'badtype'), { active: 'true', email: 'badtype@example.com' }),
        setDoc(doc(db, 'admins', 'noemail'), { active: true })
      ]);
    });
    for (const uid of ['inactive', 'mismatch', 'badtype', 'noemail', 'absent']) {
      await assertFails(getDocs(collection(dbFor(uid), 'profiles')));
    }
    await assertFails(getDocs(collection(dbFor('claimonly', { admin: true }), 'profiles')));
    await assertFails(getDocs(collection(dbFor('admin', { email: 'wrong@example.com' }), 'profiles')));
    await assertFails(getDocs(collection(dbFor('admin', { email: null }), 'profiles')));
    await assertSucceeds(getDocs(collection(dbFor('admin'), 'profiles')));
  });
  it('grants and immediately revokes access when a trusted operator changes the admin document', async () => {
    const user = dbFor('newadmin');
    const profiles = collection(user, 'profiles');
    await assertFails(getDocs(profiles));
    await env.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'admins', 'newadmin'), { active: true, email: 'newadmin@example.com' }));
    await assertSucceeds(getDocs(profiles));
    await env.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), 'admins', 'newadmin'), { active: false }));
    await assertFails(getDocs(profiles));
    await env.withSecurityRulesDisabled(async (context) => deleteDoc(doc(context.firestore(), 'admins', 'newadmin')));
    await assertFails(getDocs(profiles));
  });
  it('lets users submit only pending registrations and only admins approve them', async () => {
    const newcomer = dbFor('newuser');
    const application = { ...userProfile('newuser', 'individual', 'pending'), createdAt: serverTimestamp(), consentAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(newcomer, 'profiles', 'newuser'), application));
    await assertFails(updateDoc(doc(newcomer, 'profiles', 'newuser'), { status: 'approved' }));
    await assertFails(getDoc(doc(dbFor('org1'), 'profiles', 'newuser')));
    await assertFails(setDoc(doc(dbFor('fraud'), 'profiles', 'fraud'), { ...userProfile('fraud', 'restaurant', 'approved'), createdAt: serverTimestamp(), consentAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(dbFor('admin'), 'profiles', 'newuser'), { status: 'approved', reviewNote: '', reviewedBy: 'admin', reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertSucceeds(getDocs(collection(dbFor('admin'), 'profiles')));
  });
  it('allows photo or video links without Storage and rejects unsafe or excessive evidence', async () => {
    const applicant = dbFor('newrestaurant');
    const profileRef = doc(applicant, 'profiles', 'newrestaurant');
    const application = { ...userProfile('newrestaurant', 'restaurant', 'pending'), website: '',
      evidenceUrls: ['https://example.com/photo.jpg', 'https://example.com/video'],
      createdAt: serverTimestamp(), consentAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertFails(setDoc(profileRef, { ...application, evidenceUrls: ['javascript:alert(1)'] }));
    await assertFails(setDoc(profileRef, { ...application, evidenceUrls: Array(6).fill('https://example.com/photo') }));
    await assertFails(setDoc(profileRef, { ...application, evidenceUrls: ['https://example.com/' + 'a'.repeat(500)] }));
    await assertSucceeds(setDoc(profileRef, application));
    await assertFails(getDoc(doc(dbFor('individual'), 'profiles', 'newrestaurant')));
  });
  it('allows a rejected applicant to resubmit without changing role, email or original submission time', async () => {
    const admin = dbFor('admin');
    const org = dbFor('org1');
    const profileRef = doc(org, 'profiles', 'org1');
    await assertSucceeds(updateDoc(doc(admin, 'profiles', 'org1'), {
      status: 'rejected', reviewNote: 'Please update the address.', reviewedBy: 'admin',
      reviewedAt: serverTimestamp(), updatedAt: serverTimestamp()
    }));
    const original = (await getDoc(profileRef)).data();
    const resubmission = { ...original, status: 'pending', address: 'Updated address', consentAt: serverTimestamp(),
      updatedAt: serverTimestamp(), reviewedAt: null, reviewedBy: '', reviewNote: '' };
    await assertFails(setDoc(profileRef, { ...resubmission, role: 'restaurant' }));
    await assertFails(setDoc(profileRef, { ...resubmission, email: 'other@example.com' }));
    await assertFails(setDoc(profileRef, { ...resubmission, createdAt: ts(-1000) }));
    await assertSucceeds(setDoc(profileRef, resubmission));
    await assertFails(setDoc(profileRef, { ...resubmission, address: 'Another update' }));
  });
  it('allows a rejected legacy applicant to replace Storage paths with safe URLs', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const ref = doc(context.firestore(), 'profiles', 'org1');
      const original = (await getDoc(ref)).data();
      const { evidenceUrls: _removed, ...legacy } = original;
      await setDoc(ref, { ...legacy, status: 'rejected', website: '', evidencePaths: ['verification/org1/old.png'] });
    });
    const org = dbFor('org1');
    const ref = doc(org, 'profiles', 'org1');
    const { evidencePaths: _removed, ...existing } = (await getDoc(ref)).data();
    await assertSucceeds(setDoc(ref, { ...existing, status: 'pending', evidenceUrls: ['https://example.com/proof'],
      consentAt: serverTimestamp(), updatedAt: serverTimestamp(), reviewedAt: null, reviewedBy: '', reviewNote: '' }));
  });
  it('restricts food listings to approved organizations and the owning restaurant, while individuals can see active centers', async () => {
    await assertSucceeds(getDoc(doc(dbFor('individual'), 'centers', 'center')));
    await assertFails(getDoc(doc(dbFor('individual'), 'listings', 'food')));
    await assertFails(getDoc(doc(dbFor('pendingorg'), 'listings', 'food')));
    await assertSucceeds(getDocs(query(collection(dbFor('org1'), 'listings'), where('status', '==', 'available'))));
    await assertSucceeds(getDocs(query(collection(dbFor('restaurant'), 'listings'), where('restaurantId', '==', 'restaurant'))));
    await assertFails(getDoc(doc(dbFor('org1'), 'profiles', 'restaurant')));
  });
  it('only allows an approved restaurant to publish its own valid listing at an active center', async () => {
    const payload = { ...listingData(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(dbFor('restaurant'), 'listings', 'new-food'), payload));
    await assertFails(setDoc(doc(dbFor('individual'), 'listings', 'forged-food'), payload));
    await assertFails(setDoc(doc(dbFor('restaurant'), 'listings', 'wrong-center'), { ...payload, centerAddress: 'Fake address' }));
    await assertFails(setDoc(doc(dbFor('restaurant'), 'listings', 'wrong-owner'), { ...payload, restaurantId: 'someone-else' }));
  });
  it('permits safe matching booking photos and prevents forging their URL', async () => {
    await env.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), 'listings', 'food'), { imageUrl: 'https://example.org/rice.jpg' }));
    const org = dbFor('org1');
    async function reservePhoto(id, imageUrl) {
      const listing = doc(org, 'listings', 'food'); const booking = doc(org, 'bookings', id);
      return runTransaction(org, async (tx) => {
        const snap = await tx.get(listing);
        tx.set(booking, { ...bookingData('org1', snap.data()), imageUrl });
        tx.update(listing, { status: 'booked', bookedBy: 'org1', bookingId: id, updatedAt: serverTimestamp() });
      });
    }
    await assertFails(reservePhoto('forged', 'https://example.org/other.jpg'));
    await assertFails(reservePhoto('unsafe', 'javascript:alert(1)'));
    await assertSucceeds(reservePhoto('photo-booking', 'https://example.org/rice.jpg'));
    expect((await getDoc(doc(org, 'bookings', 'photo-booking'))).data().imageUrl).toBe('https://example.org/rice.jpg');
    await assertFails(updateDoc(doc(org, 'bookings', 'photo-booking'), { imageUrl: 'https://example.org/other.jpg', updatedAt: serverTimestamp() }));
  });
  it('allows active admins to cancel bookings and withdraw listings only as an atomic pair', async () => {
    const org = dbFor('org1'); const admin = dbFor('admin');
    await assertSucceeds(reserve(org, 'org1', 'booking1'));
    const listing = doc(admin, 'listings', 'food'); const booking = doc(admin, 'bookings', 'booking1');
    await assertFails(updateDoc(booking, { status: 'cancelled', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(listing, { status: 'cancelled', bookedBy: '', bookingId: '', updatedAt: serverTimestamp() }));
    const withdrawTogether = (db) => runTransaction(db, async (tx) => {
      const l = doc(db, 'listings', 'food'); const b = doc(db, 'bookings', 'booking1');
      await Promise.all([tx.get(l), tx.get(b)]);
      tx.update(b, { status: 'cancelled', updatedAt: serverTimestamp() });
      tx.update(l, { status: 'cancelled', bookedBy: '', bookingId: '', updatedAt: serverTimestamp() });
    });
    await assertFails(withdrawTogether(org));
    await assertSucceeds(withdrawTogether(admin));
    expect((await getDoc(listing)).data()).toMatchObject({ status: 'cancelled', bookedBy: '', bookingId: '' });
    expect((await getDoc(booking)).data().status).toBe('cancelled');
    await assertFails(reserve(dbFor('org2'), 'org2', 'after-withdrawal'));
  });
  it('allows an admin to confirm collection atomically without granting it to other organizations', async () => {
    const org = dbFor('org1'); const other = dbFor('org2'); const admin = dbFor('admin');
    await assertSucceeds(reserve(org, 'org1', 'booking1'));
    const listing = doc(admin, 'listings', 'food'); const booking = doc(admin, 'bookings', 'booking1');
    await assertFails(updateDoc(booking, { status: 'collected', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(listing, { status: 'collected', updatedAt: serverTimestamp() }));
    await assertFails(collect(other, 'booking1'));
    await assertSucceeds(collect(admin, 'booking1'));
    expect((await getDoc(listing)).data().status).toBe('collected');
    expect((await getDoc(booking)).data().status).toBe('collected');
  });
  it('requires an atomic booking, prevents double-booking, and supports cancellation and collection', async () => {
    const org1 = dbFor('org1'); const org2 = dbFor('org2');
    await assertFails(updateDoc(doc(org1, 'listings', 'food'), { status: 'booked', bookedBy: 'org1', bookingId: 'unpaired', updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(org1, 'bookings', 'unpaired'), bookingData('org1', listingData())));
    const attempts = await Promise.allSettled([reserve(org1, 'org1', 'booking1'), reserve(org2, 'org2', 'booking2')]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const winner = attempts[0].status === 'fulfilled' ? { db: org1, id: 'booking1' } : { db: org2, id: 'booking2' };
    const other = attempts[0].status === 'fulfilled' ? { db: org2, uid: 'org2', id: 'booking3' } : { db: org1, uid: 'org1', id: 'booking3' };
    await assertSucceeds(cancel(winner.db, winner.id));
    await assertSucceeds(reserve(other.db, other.uid, other.id));
    await assertFails(updateDoc(doc(other.db, 'bookings', other.id), { status: 'collected', updatedAt: serverTimestamp() }));
    await assertSucceeds(collect(dbFor('restaurant'), other.id));
    expect((await getDoc(doc(other.db, 'bookings', other.id))).data().status).toBe('collected');
  });
  it('allows an administrator to withdraw an available listing but not another participant', async () => {
    await assertFails(updateDoc(doc(dbFor('org1'), 'listings', 'food'), { status: 'cancelled', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(dbFor('admin'), 'listings', 'food'), { status: 'cancelled', updatedAt: serverTimestamp() }));
  });
  it('prevents booking if a center or restaurant loses approval', async () => {
    await env.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), 'centers', 'center'), { active: false }));
    await assertFails(reserve(dbFor('org1'), 'org1', 'closed-center'));
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'centers', 'center'), { active: true });
      await updateDoc(doc(context.firestore(), 'profiles', 'restaurant'), { status: 'rejected' });
    });
    await assertFails(reserve(dbFor('org1'), 'org1', 'revoked-restaurant'));
  });
});
