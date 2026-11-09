import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { db, errorMessage } from '../firebase.js';
import { escapeHTML, formatDate, safeFoodImageUrl, validateListingTimes } from '../model.js';
import { protectPage } from '../session.js';
import { busy, foodPhotoMarkup, hideBrokenFoodPhotos, installShell, setMessage } from '../ui.js';

installShell();

async function init() {
  const session = await protectPage(['restaurant']);

  if (session) {
    document.getElementById('donor-action').hidden = false;
    document.getElementById('restaurant-welcome').textContent =
      `Welcome, ${session.profile.name}. Manage your food listings and collection details.`;

    const form = document.getElementById('listing-form');
    const list = document.getElementById('donor-listings');
    const message = document.getElementById('donor-message');
    const listingMessage = document.getElementById('listing-message');
    const select = document.getElementById('food-center');
    const submit = document.getElementById('listing-submit');
    const field = (name) => document.getElementById(`food-${name}`);

    let centers = [];
    let listings = [];
    let bookings = [];
    let posting = false;

    hideBrokenFoodPhotos(list);

    const imageInput = field('image-url');
    const imagePreview = document.getElementById('food-image-preview');
    const imageWarning = document.getElementById('food-image-warning');
    let previewUrl = '';

    function clearImagePreview() {
      previewUrl = '';
      imagePreview.hidden = true;
      imagePreview.removeAttribute('src');
      imageWarning.hidden = true;
    }

    function showImageWarning(text) {
      imageWarning.textContent = text;
      imageWarning.hidden = false;
    }

    imageInput.addEventListener('input', clearImagePreview);

    imageInput.addEventListener('change', () => {
      clearImagePreview();

      const input = imageInput.value.trim();
      if (!input) return;

      const url = safeFoodImageUrl(input);

      if (!url) {
        showImageWarning(
          'Enter a public http:// or https:// image link of at most 500 characters.'
        );
        return;
      }

      previewUrl = url;
      imagePreview.src = url;
    });

    imagePreview.addEventListener('load', () => {
      if (!previewUrl || imagePreview.src !== previewUrl) return;

      imagePreview.hidden = false;
      imageWarning.hidden = true;
    });

    imagePreview.addEventListener('error', () => {
      if (!previewUrl || imagePreview.src !== previewUrl) return;

      imagePreview.hidden = true;
      showImageWarning(
        'Could not load the preview. Check that the link opens a public image directly.'
      );
    });

    onSnapshot(
      query(collection(db, 'centers'), where('active', '==', true)),
      (snapshot) => {
        const previous = select.value;

        centers = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((center) => center.type === 'foodbridge')
          .sort((a, b) => a.name.localeCompare(b.name));

        select.innerHTML = centers.length
          ? `<option value="">Choose a FoodBridge center</option>${centers.map((center) => `<option value="${escapeHTML(center.id)}">${escapeHTML(center.name)} — ${escapeHTML(center.city)}</option>`).join('')}`
          : '<option value="">No FoodBridge centers have been added yet</option>';

        if (centers.some((center) => center.id === previous)) {
          select.value = previous;
        }

        select.disabled = !centers.length;
        submit.disabled = posting || !centers.length;
        renderListings();
      },
      (error) => {
        select.innerHTML = '<option value="">Could not load centers</option>';
        setMessage(listingMessage, errorMessage(error));
      }
    );

    function renderListings() {
      const now = new Date();

      const currentCenter = (item) => centers.some((center) =>
        center.id === item.centerId &&
        center.name === item.centerName &&
        center.address === item.centerAddress &&
        center.city === item.centerCity
      );

      document.getElementById('stat-available').textContent = listings.filter(
        (item) => item.status === 'available' &&
          item.pickupBy?.toDate() > now &&
          currentCenter(item)
      ).length;

      document.getElementById('stat-booked').textContent =
        listings.filter((item) => item.status === 'booked').length;

      document.getElementById('stat-collected').textContent =
        listings.filter((item) => item.status === 'collected').length;

      if (!listings.length) {
        list.innerHTML =
          '<div class="empty-state">You haven’t shared any food yet. Your listings will appear here.</div>';
        return;
      }

      list.innerHTML = listings.map((item) => {
        const booking = bookings.find(
          (entry) => entry.id === item.bookingId && entry.status === 'booked'
        );

        const expired =
          item.status === 'available' && item.pickupBy?.toDate() <= now;

        const status = expired ? 'Expired' : item.status;

        const centerWarning =
          item.status === 'available' && !currentCenter(item)
            ? '<div class="notice mt-3">This center is unavailable or its details have changed. Cancel this listing and create a new one with a current center.</div>'
            : '';

        const details = booking
          ? `<div class="notice info mt-3"><strong>Collection by ${escapeHTML(booking.organizationName)}</strong><p>Pickup: ${escapeHTML(formatDate(booking.pickupAt))}<br>Contact: ${escapeHTML(booking.contactName)} · ${escapeHTML(booking.contactPhone)}<br>Transport: ${escapeHTML(booking.transport)}${booking.notes ? `<br>Notes: ${escapeHTML(booking.notes)}` : ''}</p></div>`
          : '';

        let action = '';

        if (item.status === 'available') {
          action = `<button class="button button-danger button-small" type="button" data-action="cancel" data-id="${escapeHTML(item.id)}">Cancel listing</button>`;
        }

        if (item.status === 'booked') {
          action = `<button class="button button-primary button-small" type="button" data-action="collect" data-id="${escapeHTML(item.id)}" data-booking="${escapeHTML(item.bookingId)}">Mark collected</button>`;
        }

        return `<article class="data-card">${foodPhotoMarkup(item.imageUrl, item.title)}<div class="card-heading"><div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.quantity)} ${escapeHTML(item.unit)} · ${escapeHTML(item.category)}</p></div><span class="pill ${escapeHTML(item.status)}">${escapeHTML(status)}</span></div><div class="meta-grid"><div class="meta-item"><strong>Collection center</strong>${escapeHTML(item.centerName)}, ${escapeHTML(item.centerCity)}</div><div class="meta-item"><strong>Pickup window</strong>${escapeHTML(formatDate(item.availableFrom))} – ${escapeHTML(formatDate(item.pickupBy))}</div></div>${centerWarning}${details}${action ? `<div class="card-actions">${action}</div>` : ''}</article>`;
      }).join('');
    }

    window.setInterval(renderListings, 60000);

    onSnapshot(
      query(
        collection(db, 'listings'),
        where('restaurantId', '==', session.user.uid)
      ),
      (snapshot) => {
        listings = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort(
            (a, b) =>
              (b.createdAt?.toMillis() || 0) -
              (a.createdAt?.toMillis() || 0)
          );

        renderListings();
      },
      (error) => {
        list.innerHTML = `<div class="notice error">${escapeHTML(errorMessage(error))}</div>`;
      }
    );

    onSnapshot(
      query(
        collection(db, 'bookings'),
        where('restaurantId', '==', session.user.uid)
      ),
      (snapshot) => {
        bookings = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data()
        }));

        renderListings();
      },
      (error) => setMessage(message, errorMessage(error))
    );

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (posting) return;

      setMessage(listingMessage, '');

      const center = centers.find((item) => item.id === select.value);
      if (!center) {
        setMessage(listingMessage, 'Please choose an active FoodBridge center.');
        return;
      }

      const timeError = validateListingTimes(
        field('prepared').value,
        field('start').value,
        field('deadline').value
      );

      if (timeError) {
        setMessage(listingMessage, timeError);
        return;
      }

      const quantity = Number(field('quantity').value);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
        setMessage(
          listingMessage,
          'Please enter a whole quantity between 1 and 100,000.'
        );
        return;
      }

      const imageInputValue = imageInput.value.trim();
      const imageUrl = imageInputValue
        ? safeFoodImageUrl(imageInputValue)
        : '';

      if (imageInputValue && !imageUrl) {
        setMessage(
          listingMessage,
          'Please enter a valid public http:// or https:// image URL of at most 500 characters.'
        );
        return;
      }

      const title = field('title').value.trim();
      const description = field('description').value.trim();
      const allergens = field('allergens').value.trim();
      const storageInstructions = field('storage').value.trim();

      if (!title || !description || !allergens || !storageInstructions) {
        setMessage(listingMessage, 'Please complete all food and safety details.');
        return;
      }

      posting = true;
      busy(submit, true, 'Publishing…');

      try {
        const listingRef = doc(collection(db, 'listings'));

        await setDoc(listingRef, {
          restaurantId: session.user.uid,
          restaurantName: session.profile.name,
          restaurantPhone: session.profile.phone,
          title,
          category: field('category').value,
          quantity,
          unit: field('unit').value,
          description,
          allergens,
          storageInstructions,
          ...(imageUrl ? { imageUrl } : {}),
          preparedAt: Timestamp.fromDate(new Date(field('prepared').value)),
          availableFrom: Timestamp.fromDate(new Date(field('start').value)),
          pickupBy: Timestamp.fromDate(new Date(field('deadline').value)),
          centerId: center.id,
          centerName: center.name,
          centerAddress: center.address,
          centerCity: center.city,
          status: 'available',
          bookedBy: '',
          bookingId: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        form.reset();
        clearImagePreview();

        setMessage(
          listingMessage,
          'Your food donation is now available to approved organizations.',
          'success'
        );
      } catch (error) {
        setMessage(listingMessage, errorMessage(error));
      } finally {
        posting = false;
        busy(submit, false);
        submit.disabled = !centers.length;
      }
    });

    list.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;

      const listingRef = doc(db, 'listings', button.dataset.id);
      setMessage(message, '');

      if (button.dataset.action === 'cancel') {
        if (!window.confirm('Cancel this available food listing?')) return;

        busy(button, true, 'Cancelling…');

        try {
          await updateDoc(listingRef, {
            status: 'cancelled',
            updatedAt: serverTimestamp()
          });

          setMessage(message, 'The listing was cancelled.', 'success');
        } catch (error) {
          setMessage(message, errorMessage(error));
          busy(button, false);
        }
      } else {
        if (!window.confirm('Confirm that the organization has collected this food?')) return;

        busy(button, true, 'Updating…');

        try {
          await runTransaction(db, async (transaction) => {
            const bookingRef = doc(db, 'bookings', button.dataset.booking);

            const [listing, booking] = await Promise.all([
              transaction.get(listingRef),
              transaction.get(bookingRef)
            ]);

            if (
              !listing.exists() ||
              listing.data().status !== 'booked' ||
              !booking.exists() ||
              booking.data().status !== 'booked'
            ) {
              throw new Error('This booking is no longer awaiting collection.');
            }

            transaction.update(listingRef, {
              status: 'collected',
              updatedAt: serverTimestamp()
            });

            transaction.update(bookingRef, {
              status: 'collected',
              updatedAt: serverTimestamp()
            });
          });

          setMessage(
            message,
            'Collection confirmed. Thank you for sharing.',
            'success'
          );
        } catch (error) {
          setMessage(message, errorMessage(error));
          busy(button, false);
        }
      }
    });
  }
}

init();
