import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Never initialize a live Firebase project in tests.
const fake = vi.hoisted(() => ({ initializeApp: vi.fn((options) => ({ options })) }));
vi.mock('firebase/app', () => ({ initializeApp: fake.initializeApp }));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({}),
  GoogleAuthProvider: class { setCustomParameters() {} }
}));
vi.mock('firebase/firestore', () => ({ getFirestore: () => ({}) }));

const envNames = [
  'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID', 'VITE_FIREBASE_MEASUREMENT_ID'
];
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  envNames.forEach((name) => vi.stubEnv(name, ''));
  fake.initializeApp.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('Firebase web configuration', () => {
  it('uses the bundled FoodBridge web project when there is no environment override', async () => {
    const firebase = await import('../src/firebase.js');
    expect(firebase.isConfigured).toBe(true);
    expect(fake.initializeApp).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'food-bridge-53bb7',
      storageBucket: 'food-bridge-53bb7.firebasestorage.app',
      measurementId: 'G-KQ4Z2LD3XT'
    }));
  });

  it('accepts a complete environment override for another project', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'test.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project');
    vi.stubEnv('VITE_FIREBASE_APP_ID', 'test-app');
    const firebase = await import('../src/firebase.js');
    expect(firebase.isConfigured).toBe(true);
    expect(fake.initializeApp).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'test-project', storageBucket: ''
    }));
  });

  it('rejects a partial environment override rather than mixing Firebase projects', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'other-project');
    const firebase = await import('../src/firebase.js');
    expect(firebase.isConfigured).toBe(false);
    expect(fake.initializeApp).not.toHaveBeenCalled();
    expect(firebase.auth).toBeNull();
  });
});
