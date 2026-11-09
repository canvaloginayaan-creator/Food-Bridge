import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { dashboardFor, escapeHTML, safeFoodImageUrl } from './model.js';
import { logOut } from './session.js';

const brand = `<a class="brand" href="index.html" aria-label="FoodBridge PK home"><span class="brand-symbol" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M8 22c2.3 6.3 6.6 9.5 12 9.5S29.7 28.3 32 22" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><path d="M20 24V9m0 9c-5.8.1-8.7-3.1-8.7-8 5.8-.2 8.7 3.1 8.7 8Zm0-3c0-4.7 3.2-7.7 8.3-7.8.3 4.9-2.5 7.9-8.3 7.8Z" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="brand-word">foodbridge<span class="brand-pk"> PK</span><small>SHARE THE GOOD</small></span></a>`;

export function setMessage(node, text, kind = 'error') {
  if (!node) return;

  node.textContent = text;
  node.className = text ? `form-message ${kind}` : 'form-message';
  node.hidden = !text;
}

export function busy(button, isBusy, label = 'Please wait…') {
  if (!button) return;

  if (isBusy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = label;
  } else if (button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel;
    delete button.dataset.originalLabel;
  }

  button.disabled = isBusy;
}

export function foodPhotoMarkup(rawUrl, title) {
  const url = safeFoodImageUrl(rawUrl);

  return url
    ? `<img class="food-photo" src="${escapeHTML(url)}" alt="Photo of ${escapeHTML(title || 'food')}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '';
}

export function hideBrokenFoodPhotos(container) {
  container.addEventListener(
    'error',
    (event) => {
      if (event.target.matches?.('img.food-photo')) {
        event.target.hidden = true;
      }
    },
    true
  );
}

export function installShell() {
  const header = document.getElementById('site-header');
  const footer = document.getElementById('site-footer');

  if (header) {
    header.className = 'site-header';

    header.innerHTML = `<div class="wrap nav-inner">${brand}<button class="menu-toggle" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="site-nav"><span></span><span></span><span></span></button><nav id="site-nav" class="site-nav" aria-label="Main navigation"><div class="nav-links"><a href="index.html">Home</a><a href="index.html#how-it-works">How it works</a><a href="about.html">About</a><a href="impact.html">Food safety</a></div><div id="account-nav" class="account-nav"><a class="nav-login" href="login.html">Log in</a><a class="button button-primary button-small" href="register.html">Join FoodBridge <span aria-hidden="true">↗</span></a></div></nav></div>`;

    const toggle = header.querySelector('.menu-toggle');
    const nav = header.querySelector('#site-nav');

    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';

      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute(
        'aria-label',
        open ? 'Close navigation' : 'Open navigation'
      );

      nav.classList.toggle('is-open', open);
    });

    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open navigation');
      }
    });
  }

  if (footer) {
    footer.className = 'site-footer';

    footer.innerHTML = `<div class="wrap"><div class="footer-top"><div class="footer-about">${brand}<p>Good food, shared with care.<br>Building a more nourished Pakistan together.</p></div><div><span class="footer-label">DISCOVER</span><a href="index.html#how-it-works">How it works</a><a href="about.html">Our story</a><a href="impact.html">Food safety</a></div><div><span class="footer-label">GET INVOLVED</span><a href="register.html">Join FoodBridge</a><a href="login.html">Log in</a></div><div class="footer-mission"><span class="footer-label">OUR LITTLE REMINDER</span><p>Every good meal<br>deserves a purpose.</p><span aria-hidden="true">✳</span></div></div><div class="footer-bottom"><span>© ${new Date().getFullYear()} FoodBridge PK</span><span>Made for community, powered by kindness.</span></div></div>`;
  }

  const accountNav = document.getElementById('account-nav');

  if (!auth || !accountNav) return;

  let stopProfileListener;

  onAuthStateChanged(auth, (user) => {
    if (stopProfileListener) stopProfileListener();

    if (!user) {
      accountNav.innerHTML =
        '<a class="nav-login" href="login.html">Log in</a><a class="button button-primary button-small" href="register.html">Join FoodBridge <span aria-hidden="true">↗</span></a>';

      return;
    }

    const render = (profile) => {
      const destination = dashboardFor(profile);

      const label = !profile
        ? 'Complete registration'
        : profile.role === 'individual'
          ? 'Meal locations'
          : profile.status !== 'approved'
            ? 'My application'
            : 'My dashboard';

      accountNav.innerHTML = `<a class="button button-primary button-small" href="${escapeHTML(destination)}">${escapeHTML(label)} <span aria-hidden="true">↗</span></a><button class="nav-signout" type="button">Log out</button>`;

      accountNav.querySelector('button').addEventListener('click', () => {
        logOut().catch(() => {
          setMessage(
            document.getElementById('global-message'),
            'Could not sign out. Please try again.'
          );
        });
      });
    };

    stopProfileListener = onSnapshot(
      doc(db, 'profiles', user.uid),
      (snapshot) => render(snapshot.exists() ? snapshot.data() : null),
      () => render(null)
    );
  });
}
