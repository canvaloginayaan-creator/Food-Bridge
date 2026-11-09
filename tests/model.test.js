import { describe, expect, it } from 'vitest';
import { dashboardFor, escapeHTML, safeExternalUrl, parseEvidenceUrls, validateListingTimes, validatePickupTime } from '../src/model.js';

describe('account routing', () => {
  it('sends each role to its own approved or pending experience', () => {
    expect(dashboardFor(null)).toBe('register.html?finish=1');
    expect(dashboardFor({ role: 'restaurant', status: 'pending' })).toBe('application.html');
    expect(dashboardFor({ role: 'restaurant', status: 'approved' })).toBe('donor-dashboard.html');
    expect(dashboardFor({ role: 'organization', status: 'rejected' })).toBe('application.html');
    expect(dashboardFor({ role: 'organization', status: 'approved' })).toBe('receiver-dashboard.html');
    expect(dashboardFor({ role: 'individual', status: 'pending' })).toBe('centers.html');
    expect(dashboardFor({ role: 'individual', status: 'rejected' })).toBe('centers.html');
  });
});

describe('input and output safety', () => {
  it('escapes user-supplied markup and accepts only HTTP(S) external links', () => {
    expect(escapeHTML(`<img src=x onerror="bad"> & 'x'`)).toBe('&lt;img src=x onerror=&quot;bad&quot;&gt; &amp; &#39;x&#39;');
    expect(safeExternalUrl('javascript:alert(1)')).toBe('');
    expect(safeExternalUrl('data:text/html,hello')).toBe('');
    expect(safeExternalUrl('https://example.org/about')).toBe('https://example.org/about');
    expect(safeExternalUrl('https://user:password@example.org')).toBe('');
  });
  it('accepts up to five safe photo or video URLs, one per line', () => {
    expect(parseEvidenceUrls(' https://example.org/photo.jpg \n\nhttps://videos.example/video ')).toEqual({
      urls: ['https://example.org/photo.jpg', 'https://videos.example/video'], error: ''
    });
    expect(parseEvidenceUrls(Array(6).fill('https://example.org/photo').join('\n')).error).toMatch(/no more than 5/i);
    expect(parseEvidenceUrls('javascript:alert(1)').error).toMatch(/valid http/i);
    expect(parseEvidenceUrls('https://example.org/' + 'a'.repeat(500)).error).toMatch(/500 characters/i);
    expect(parseEvidenceUrls('https://user:pass@example.org/photo').error).toMatch(/valid http/i);
    expect(parseEvidenceUrls('').urls).toEqual([]);
  });
});

describe('food and collection windows', () => {
  const now = new Date('2026-11-06T10:00:00Z');
  it('requires already-prepared food and a future, ordered pickup window', () => {
    expect(validateListingTimes('2026-11-06T09:00:00Z', '2026-11-06T10:30:00Z', '2026-11-06T12:00:00Z', now)).toBe('');
    expect(validateListingTimes('2026-11-06T11:00:00Z', '2026-11-06T11:30:00Z', '2026-11-06T12:00:00Z', now)).toMatch(/future/);
    expect(validateListingTimes('2026-11-06T09:00:00Z', '2026-11-06T08:00:00Z', '2026-11-06T12:00:00Z', now)).toMatch(/before/);
    expect(validateListingTimes('2026-11-06T09:00:00Z', '2026-11-06T12:00:00Z', '2026-11-06T11:00:00Z', now)).toMatch(/after/);
    expect(validateListingTimes('2026-11-06T07:00:00Z', '2026-11-06T08:00:00Z', '2026-11-06T09:00:00Z', now)).toMatch(/future/);
  });
  it('only allows collection in the future and inside the advertised window', () => {
    expect(validatePickupTime('2026-11-06T11:00:00Z', '2026-11-06T10:30:00Z', '2026-11-06T12:00:00Z', now)).toBe('');
    expect(validatePickupTime('2026-11-06T10:00:00Z', '2026-11-06T09:00:00Z', '2026-11-06T12:00:00Z', now)).toMatch(/future/);
    expect(validatePickupTime('2026-11-06T12:01:00Z', '2026-11-06T10:30:00Z', '2026-11-06T12:00:00Z', now)).toMatch(/window/);
  });
});
