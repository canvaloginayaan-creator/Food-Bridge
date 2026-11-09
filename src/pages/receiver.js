import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where
} from 'firebase/firestore';

import { db, errorMessage } from '../firebase.js';

import {
  escapeHTML,
  formatDate,
  localDateTimeValue,
  safeFoodImageUrl,
  validatePickupTime
} from '../model.js';

import { protectPage } from '../session.js';

import {
  busy,
  foodPhotoMarkup,
  hideBrokenFoodPhotos,
  installShell,
  setMessage
} from '../ui.js';

installShell();

async function init() {
  const session = await protectPage(['organization']);

  if (session) {
    document.getElementById('organization-welcome').textContent =
      `Welcome, ${session.profile.name}. Find available food and arrange a collection for your community.`;

    const availableList = document.getElementById('available-list');
    const bookingList = document.getElementById('bookings-list');
    const listMessage = document.getElementById('booking-list-message');
    const search = document.getElementById('food-search');
    const dialog = document.getElementById('booking-dialog');
    const form = document.getElementById('booking-form');
    const message = document.getElementById('booking-message');
    const submit = document.getElementById('booking-submit');
    const pickupTime = document.getElementById('pickup-time');

    let available = [];
    let activeCenters = new Map();
    let centersLoaded = false;
    let selected = null;
    let bookingInFlight = false;

    hideBrokenFoodPhotos(availableList);
    hideBrokenFoodPhotos(bookingList);

    function renderAvailable() {
      const text = search.value.trim().toLowerCase();
      const now = new Date();

      if (!centersLoaded) {
        availableList.innerHTML =
          '<div class="empty-state">Loading collection centers…</div>';
        return;
      }

      const active = available.filter((item) => {
        const center = activeCenters.get(item.centerId);

        return item.pickupBy?.toDate() > now
          && center?.type === 'foodbridge'
          && center.name === item.centerName
          && center.address === item.centerAddress
          && center.city === item.centerCity;
      });

      const matches = active.filter((item) =>
        `${item.title} ${item.centerCity} ${item.centerName} ${item.category}`
          .toLowerCase()
          .includes(text)
      );

      if (!matches.length) {
        availableList.innerHTML = `<div class="empty-state">${
          active.length
            ? 'No food matches your search.'
            : 'There is no food available to book right now. Please check back later.'
        }</div>`;
        return;
      }

      availableList.innerHTML = matches.map((item) => `
        <article class="data-card listing-card">
          ${foodPhotoMarkup(item.imageUrl, item.title)}

          <div class="card-heading">
            <div>
              <span class="pill">${escapeHTML(item.category)}</span>
              <h3 style="margin-top:10px">${escapeHTML(item.title)}</h3>
              <p>
                From ${escapeHTML(item.restaurantName)} ·
                ${escapeHTML(item.quantity)} ${escapeHTML(item.unit)}
              </p>
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-item">
              <strong>FoodBridge center</strong>
              ${escapeHTML(item.centerName)}<br>
              ${escapeHTML(item.centerAddress)}, ${escapeHTML(item.centerCity)}
            </div>

            <div class="meta-item">
              <strong>Pickup window</strong>
              ${escapeHTML(formatDate(item.availableFrom))}<br>
              to ${escapeHTML(formatDate(item.pickupBy))}
            </div>

            <div class="meta-item">
              <strong>Prepared / packed</strong>
              ${escapeHTML(formatDate(item.preparedAt))}
            </div>

            <div class="meta-item">
              <strong>Business phone</strong>
              ${escapeHTML(item.restaurantPhone)}
            </div>
          </div>

          <p><strong>Food & ingredients:</strong> ${escapeHTML(item.description)}</p>
          <p><strong>Allergens:</strong> ${escapeHTML(item.allergens)}</p>
          <p><strong>Storage:</strong> ${escapeHTML(item.storageInstructions)}</p>

          <div class="card-actions">
            <button
              class="button button-primary button-small"
              type="button"
              data-book="${escapeHTML(item.id)}"
            >
              Book pickup →
            </button>
          </div>
        </article>
      `).join('');
    }

    search.addEventListener('input', renderAvailable);
    window.setInterval(renderAvailable, 60000);

    onSnapshot(
      query(collection(db, 'centers'), where('active', '==', true)),
      (snapshot) => {
        activeCenters = new Map(
          snapshot.docs.map((item) => [item.id, item.data()])
        );

        centersLoaded = true;
        renderAvailable();
      },
      (error) => {
        availableList.innerHTML =
          `<div class="notice error">${escapeHTML(errorMessage(error))}</div>`;
      }
    );

    onSnapshot(
      query(collection(db, 'listings'), where('status', '==', 'available')),
      (snapshot) => {
        available = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort(
            (a, b) =>
              (a.pickupBy?.toMillis() || 0) -
              (b.pickupBy?.toMillis() || 0)
          );

        renderAvailable();
      },
      (error) => {
        availableList.innerHTML =
          `<div class="notice error">${escapeHTML(errorMessage(error))}</div>`;
      }
    );

    onSnapshot(
      query(
        collection(db, 'bookings'),
        where('organizationId', '==', session.user.uid)
      ),
      (snapshot) => {
        const bookings = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort(
            (a, b) =>
              (b.createdAt?.toMillis() || 0) -
              (a.createdAt?.toMillis() || 0)
          );

        if (!bookings.length) {
          bookingList.innerHTML =
            '<div class="empty-state">You haven’t booked any pickups yet.</div>';
          return;
        }

        bookingList.innerHTML = bookings.map((item, index) => `
          <article class="data-card">
            <div data-booking-photo="${index}">
              ${foodPhotoMarkup(item.imageUrl, item.listingTitle)}
            </div>

            <div class="card-heading">
              <div>
                <h3>${escapeHTML(item.listingTitle)}</h3>
                <p>
                  From ${escapeHTML(item.restaurantName)} ·
                  ${escapeHTML(item.quantity)} ${escapeHTML(item.unit)}
                </p>
              </div>

              <span class="pill ${escapeHTML(item.status)}">
                ${escapeHTML(item.status)}
              </span>
            </div>

            <div class="meta-grid">
              <div class="meta-item">
                <strong>Collect from</strong>
                ${escapeHTML(item.centerName)}<br>
                ${escapeHTML(item.centerAddress)}, ${escapeHTML(item.centerCity)}
              </div>

              <div class="meta-item">
                <strong>Planned pickup</strong>
                ${escapeHTML(formatDate(item.pickupAt))}
              </div>

              <div class="meta-item">
                <strong>Collector</strong>
                ${escapeHTML(item.contactName)} · ${escapeHTML(item.contactPhone)}
              </div>

              <div class="meta-item">
                <strong>Transport</strong>
                ${escapeHTML(item.transport)}
              </div>

              <div class="meta-item">
                <strong>Food business phone</strong>
                ${escapeHTML(item.restaurantPhone)}
              </div>
            </div>

            ${
              item.status === 'booked'
                ? `<div class="card-actions">
                    <button
                      class="button button-danger button-small"
                      type="button"
                      data-cancel="${escapeHTML(item.id)}"
                      data-listing="${escapeHTML(item.listingId)}"
                    >
                      Cancel booking
                    </button>
                  </div>`
                : ''
            }
          </article>
        `).join('');

        // Older bookings may not have a saved image URL.
        const photoSlots = bookingList.querySelectorAll('[data-booking-photo]');
        const listingReads = new Map();

        bookings.forEach((item, index) => {
          if (Object.prototype.hasOwnProperty.call(item, 'imageUrl')) return;

          if (
            typeof item.listingId !== 'string' ||
            !item.listingId ||
            item.listingId.includes('/')
          ) {
            return;
          }

          if (!listingReads.has(item.listingId)) {
            listingReads.set(
              item.listingId,
              getDoc(doc(db, 'listings', item.listingId))
                .then((listing) =>
                  listing.exists() ? listing.data().imageUrl : ''
                )
                .catch(() => '')
            );
          }

          const slot = photoSlots[index];

          listingReads.get(item.listingId).then((url) => {
            if (slot?.isConnected) {
              slot.innerHTML = foodPhotoMarkup(url, item.listingTitle);
            }
          });
        });
      },
      (error) => {
        bookingList.innerHTML =
          `<div class="notice error">${escapeHTML(errorMessage(error))}</div>`;
      }
    );

    availableList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-book]');
      if (!button) return;

      selected = available.find((item) => item.id === button.dataset.book);
      if (!selected) return;

      form.reset();

      document.getElementById('pickup-name').value =
        session.profile.contactName || '';

      document.getElementById('pickup-phone').value =
        session.profile.phone || '';

      const nextMinute = Math.ceil(Date.now() / 60000) * 60000;

      pickupTime.min = localDateTimeValue(
        new Date(Math.max(nextMinute, selected.availableFrom.toMillis()))
      );

      pickupTime.max = localDateTimeValue(selected.pickupBy);

      document.getElementById('booking-summary').innerHTML = `
        <strong>
          ${escapeHTML(selected.title)} ·
          ${escapeHTML(selected.quantity)} ${escapeHTML(selected.unit)}
        </strong>
        <p>
          Collect from ${escapeHTML(selected.centerName)},
          ${escapeHTML(selected.centerAddress)},
          ${escapeHTML(selected.centerCity)}<br>
          ${escapeHTML(formatDate(selected.availableFrom))}
          to ${escapeHTML(formatDate(selected.pickupBy))}
        </p>
      `;

      setMessage(message, '');
      dialog.showModal();
    });

    const closeButton = document.getElementById('booking-close');

    closeButton.addEventListener('click', () => {
      if (!bookingInFlight) dialog.close();
    });

    dialog.addEventListener('cancel', (event) => {
      if (bookingInFlight) event.preventDefault();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!selected || bookingInFlight) return;

      setMessage(message, '');

      const timeError = validatePickupTime(
        pickupTime.value,
        selected.availableFrom,
        selected.pickupBy
      );

      if (timeError) {
        setMessage(message, timeError);
        return;
      }

      const contactName = document.getElementById('pickup-name').value.trim();
      const contactPhone = document.getElementById('pickup-phone').value.trim();
      const transport = document.getElementById('pickup-transport').value.trim();
      const notes = document.getElementById('pickup-notes').value.trim();

      if (!contactName || contactPhone.length < 7 || !transport) {
        setMessage(message, 'Please complete the collector and transport details.');
        return;
      }

      bookingInFlight = true;
      closeButton.disabled = true;
      busy(submit, true, 'Booking…');

      try {
        const listingRef = doc(db, 'listings', selected.id);
        const bookingRef = doc(collection(db, 'bookings'));

        await runTransaction(db, async (transaction) => {
          const listing = await transaction.get(listingRef);

          if (
            !listing.exists() ||
            listing.data().status !== 'available' ||
            listing.data().pickupBy.toDate() <= new Date()
          ) {
            throw new Error('Sorry, this food is no longer available.');
          }

          const item = listing.data();

          const latestTimeError = validatePickupTime(
            pickupTime.value,
            item.availableFrom,
            item.pickupBy
          );

          if (latestTimeError) throw new Error(latestTimeError);

          const rawImageUrl =
            typeof item.imageUrl === 'string' ? item.imageUrl : '';

          const bookingImageUrl =
            rawImageUrl.length <= 500 &&
            /^https?:\/\/[^\s]+$/.test(rawImageUrl) &&
            safeFoodImageUrl(rawImageUrl)
              ? rawImageUrl
              : '';

          transaction.set(bookingRef, {
            listingId: listing.id,
            listingTitle: item.title,
            imageUrl: bookingImageUrl,

            restaurantId: item.restaurantId,
            restaurantName: item.restaurantName,
            restaurantPhone: item.restaurantPhone,

            quantity: item.quantity,
            unit: item.unit,

            organizationId: session.user.uid,
            organizationName: session.profile.name,

            centerId: item.centerId,
            centerName: item.centerName,
            centerAddress: item.centerAddress,
            centerCity: item.centerCity,

            contactName,
            contactPhone,
            transport,
            notes,

            pickupAt: Timestamp.fromDate(new Date(pickupTime.value)),
            selfPickup: true,

            status: 'booked',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });

          transaction.update(listingRef, {
            status: 'booked',
            bookedBy: session.user.uid,
            bookingId: bookingRef.id,
            updatedAt: serverTimestamp()
          });
        });

        dialog.close();
        selected = null;

        setMessage(
          listMessage,
          'Your pickup is booked. Please arrange your own collection from the center.',
          'success'
        );

        document.getElementById('my-bookings').scrollIntoView({
          behavior: 'smooth'
        });
      } catch (error) {
        setMessage(
          message,
          error.code === 'permission-denied'
            ? 'This food could not be booked. It may have just been booked, expired, or the center or an account is no longer approved. Please refresh and try again.'
            : errorMessage(error)
        );
      } finally {
        bookingInFlight = false;
        closeButton.disabled = false;
        busy(submit, false);
      }
    });

    bookingList.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-cancel]');

      if (
        !button ||
        !window.confirm(
          'Cancel this pickup booking and make the food available again?'
        )
      ) {
        return;
      }

      setMessage(listMessage, '');
      busy(button, true, 'Cancelling…');

      try {
        const bookingRef = doc(db, 'bookings', button.dataset.cancel);
        const listingRef = doc(db, 'listings', button.dataset.listing);

        await runTransaction(db, async (transaction) => {
          const [booking, listing] = await Promise.all([
            transaction.get(bookingRef),
            transaction.get(listingRef)
          ]);

          if (
            !booking.exists() ||
            booking.data().status !== 'booked' ||
            !listing.exists() ||
            listing.data().status !== 'booked' ||
            listing.data().bookingId !== booking.id
          ) {
            throw new Error('This booking can no longer be cancelled.');
          }

          transaction.update(bookingRef, {
            status: 'cancelled',
            updatedAt: serverTimestamp()
          });

          transaction.update(listingRef, {
            status: 'available',
            bookedBy: '',
            bookingId: '',
            updatedAt: serverTimestamp()
          });
        });

        setMessage(
          listMessage,
          'Your pickup booking was cancelled.',
          'success'
        );
      } catch (error) {
        setMessage(listMessage, errorMessage(error));
        busy(button, false);
      }
    });
  }
}

init();
