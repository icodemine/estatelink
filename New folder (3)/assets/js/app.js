(() => {
  "use strict";

  const data = window.EstateLinkData;
  const main = document.querySelector("#main-content");
  const header = document.querySelector("#site-header");
  const footer = document.querySelector("#site-footer");
  const toastRegion = document.querySelector("#toast-region");
  const backend = window.EstateLinkBackend;
  const contactFormEndpoint = "https://formspree.io/f/xrbyoplr";
  const recentlyViewedKey = "estatelink-recently-viewed";
  const listingDraftKey = "estatelink-listing-draft";
  const localListingsKey = "estatelink-local-published-listings";
  const localListingPhotoPlaceholder = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#edf2ef"/><path d="M0 400 275 175l155 135 115-95 255 185v100H0z" fill="#dce7df"/><path d="M295 315v-75l105-87 105 87v75h-70v-58h-70v58z" fill="#86a994"/><text x="400" y="440" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#536d5d">Photo preview not saved</text></svg>')}`;
  const appState = {
    favorites: new Set(),
    pendingFavoriteIds: new Set(),
    favoritesLoadingUserId: null,
    mobileMenuOpen: false,
    user: null,
    favoritesUserId: null,
    authReady: !backend?.configured,
    liveMode: Boolean(backend?.configured),
    listings: backend?.configured ? [] : readLocalListings(),
    listingsState: backend?.configured ? "loading" : "ready",
    listingsError: backend?.error || "",
    listingContacts: new Map(),
    recentlyViewed: readRecentlyViewed(),
    selectedListingImages: [],
    imagePreviewUrls: [],
    profilePhotoUrl: "",
    listingFilters: { status: "all", search: "" },
    appInstalled: window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true,
    mobileDevice: /Android|iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  };

  const escapeHTML = (value = "") =>
    String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);

  function readLocalListings() {
    try {
      const stored = JSON.parse(localStorage.getItem(localListingsKey) || "[]");
      if (!Array.isArray(stored)) throw new Error("Saved local listings are not in the expected format.");
      return stored.filter((listing) =>
        listing && typeof listing.id === "string" &&
        typeof listing.title === "string" &&
        typeof listing.price === "number"
      ).map((listing) => ({
        ...listing,
        localOnly: true,
        images: [localListingPhotoPlaceholder],
        image: localListingPhotoPlaceholder,
        imagePlaceholder: true
      }));
    } catch (error) {
      console.warn("Locally published property previews could not be loaded.", error);
      return [];
    }
  }

  function persistLocalListings(listings) {
    const storedListings = listings.filter((listing) => listing.localOnly).map((listing) => {
      const { images, image, ...savedListing } = listing;
      return savedListing;
    });
    localStorage.setItem(localListingsKey, JSON.stringify(storedListings));
  }

  const money = (amount, currency = "GHS") =>
    new Intl.NumberFormat("en-GH", {
      style: "currency", currency, maximumFractionDigits: 0
    }).format(amount);

  const locationText = (listing) =>
    [listing.neighborhood, listing.city, listing.region].filter(Boolean).slice(0, 2).join(", ");

  const href = (route) => `#/${route}`;

  const currentListings = () => appState.listings;

  function normalizedStatus(listing) {
    const status = String(listing.status || "pending").toLowerCase().replace(/[\s-]+/g, "_");
    if (["published", "approved", "active"].includes(status)) return "published";
    if (["rejected", "declined"].includes(status)) return "rejected";
    if (["draft"].includes(status)) return "draft";
    return "pending";
  }

  function statusLabel(status) {
    return ({
      published: "Published",
      pending: "Pending approval",
      draft: "Draft",
      rejected: "Rejected"
    })[status] || "Pending approval";
  }

  function statusBadge(status) {
    const normalized = normalizedStatus({ status });
    return `<span class="status-pill status-pill--${normalized}">${statusLabel(normalized)}</span>`;
  }

  function ownerDraftStorageKey() {
    return `${listingDraftKey}:${appState.user?.id || "anonymous"}`;
  }

  function ownerDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(ownerDraftStorageKey()) || "null");
      return draft && typeof draft === "object" ? draft : {};
    } catch (error) {
      console.warn("The local listing draft could not be read.", error);
      return {};
    }
  }

  function readRecentlyViewed() {
    try {
      const ids = JSON.parse(localStorage.getItem(recentlyViewedKey) || "[]");
      return Array.isArray(ids) ? ids.filter((id) => typeof id === "string").slice(0, 8) : [];
    } catch (error) {
      console.warn("Recently viewed properties could not be loaded.", error);
      return [];
    }
  }

  function rememberListing(id) {
    appState.recentlyViewed = [id, ...appState.recentlyViewed.filter((item) => item !== id)].slice(0, 8);
    try {
      localStorage.setItem(recentlyViewedKey, JSON.stringify(appState.recentlyViewed));
    } catch (error) {
      console.warn("Recently viewed properties could not be saved.", error);
    }
  }

  function trustStatusMarkup(listing) {
    const indicators = Array.isArray(listing.trustIndicators)
      ? listing.trustIndicators.filter((item) =>
        item && ["Verified listing", "Verified agent", "Verified phone", "Verification pending", "Not verified"].includes(item.label)
      )
      : [];
    const labels = indicators.length
      ? indicators.map((item) => item.label)
      : [listing.verifiedLabel || "Not verified"];
    return labels.map((status) => {
      const normalized = status.toLowerCase();
      const className = normalized.includes("pending")
        ? "trust-status trust-status--pending"
        : normalized.includes("verified") && !normalized.includes("not verified")
          ? "trust-status trust-status--verified"
          : "trust-status";
      return `<span class="${className}">${escapeHTML(status)}</span>`;
    }).join(" ");
  }

  function openReportDialog(subjectType, subjectId, subjectName) {
    const reasons = subjectType === "profile"
      ? ["Suspected scam", "Fake identity", "Misleading information", "Suspicious behavior", "Other"]
      : ["Suspected scam or fraud", "Property does not exist", "Misleading or fake photos", "Incorrect property information", "Suspicious payment request", "Property is already rented or sold", "Duplicate listing", "Inappropriate or prohibited content", "Suspicious owner/agent behavior", "Other"];
    const dialog = document.createElement("dialog");
    dialog.className = "report-dialog";
    dialog.setAttribute("aria-labelledby", "report-title");
    dialog.innerHTML = `<form class="report-form" novalidate><button class="report-dialog__close" type="button" aria-label="Close report dialog">×</button><p class="eyebrow">SAFETY & TRUST</p><h2 id="report-title">Report ${subjectType === "profile" ? "profile" : "this listing"}</h2><p class="report-dialog__intro">Help us keep EstateLink GH safe by telling us what is wrong ${subjectType === "profile" ? "with this profile" : "with this listing"}.</p><p class="report-dialog__subject">${escapeHTML(subjectName)}</p><input type="hidden" name="subjectType" value="${subjectType}"><input type="hidden" name="subjectId" value="${escapeHTML(subjectId)}"><label class="field"><span>Reason <b>*</b></span><select name="reason" required><option value="">Choose a reason</option>${reasons.map((reason) => `<option>${escapeHTML(reason)}</option>`).join("")}</select></label><label class="field"><span>Additional details <small>(optional)</small></span><textarea name="details" maxlength="500" rows="4" aria-describedby="report-character-count" placeholder="Add details that may help us review this report."></textarea><small class="report-character-count" id="report-character-count">0 / 500</small></label><div class="form-errors" role="alert" hidden></div><div class="report-dialog__actions"><button class="button button--outline" type="button" data-report-cancel>Cancel</button><button class="button button--primary" type="submit">Submit report</button></div><p class="auth-note">Prototype only. This report is not sent or stored yet.</p></form>`;
    document.body.append(dialog);
    const form = dialog.querySelector("form");
    form.elements.details.addEventListener("input", () => {
      dialog.querySelector(".report-character-count").textContent = `${form.elements.details.value.length} / 500`;
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const errorBox = form.querySelector(".form-errors");
      if (!form.elements.reason.value) {
        showErrors(errorBox, ["Choose a reason for your report."]);
        form.elements.reason.focus();
        return;
      }
      form.innerHTML = `<div class="report-confirmation" role="status"><span class="report-confirmation__mark" aria-hidden="true">✓</span><h2>Thank you for helping keep EstateLink GH safe.</h2><p>This report form is a preview only. Nothing was sent or saved.</p><button class="button button--primary" type="button" data-report-done>Done</button></div>`;
    });
    dialog.querySelector(".report-dialog__close").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-report-cancel]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
      if (event.target.closest("[data-report-done]")) dialog.close();
    });
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
    form.elements.reason.focus();
  }

  async function shareListing(listing) {
    const propertyUrl = new URL(location.href);
    propertyUrl.hash = `/property/${encodeURIComponent(listing.id)}`;
    const url = propertyUrl.href;
    const title = `${listing.title} — ${locationText(listing)}`;
    const shareText = `${title} ${url}`;
    const dialog = document.createElement("dialog");
    dialog.className = "share-dialog";
    dialog.setAttribute("aria-labelledby", "share-title");
    dialog.innerHTML = `<div class="share-dialog__content"><button class="report-dialog__close" type="button" aria-label="Close share options">×</button><p class="eyebrow">SHARE PROPERTY</p><h2 id="share-title">${escapeHTML(listing.title)}</h2>${navigator.share ? `<button class="button button--primary button--full" type="button" data-share-action="native">Share using your device</button>` : ""}<button class="button button--outline button--full" type="button" data-share-action="copy">Copy link</button><a class="button button--outline button--full" href="https://wa.me/?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a><a class="button button--outline button--full" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">Share on Facebook</a></div>`;
    document.body.append(dialog);
    dialog.querySelector(".report-dialog__close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
      const action = event.target.closest("[data-share-action]")?.dataset.shareAction;
      if (action === "native") {
        navigator.share({ title: listing.title, text: title, url })
          .catch((error) => {
            if (error.name !== "AbortError") showToast("Sharing is unavailable. Try copying the property link.");
          });
      } else if (action === "copy") {
        copyText(url).then(() => {
          showToast("Property link copied.", "success");
          dialog.close();
        }).catch(() => showToast("Could not copy the link. Copy the page address from your browser instead."));
      }
    });
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) throw new Error("Clipboard access is unavailable.");
  }

  function normalizeContactPhone(value) {
    const input = String(value || "").trim();
    if (!input) return "";
    const compact = input.replace(/[\s().-]/g, "");
    let international = compact;
    if (compact.startsWith("00")) international = `+${compact.slice(2)}`;
    else if (/^\d{9}$/.test(compact)) international = `+233${compact}`;
    else if (/^0\d{9}$/.test(compact)) international = `+233${compact.slice(1)}`;
    else if (/^233\d{9}$/.test(compact)) international = `+${compact}`;
    return /^\+[1-9]\d{7,14}$/.test(international) ? international : "";
  }

  function validContactEmail(value) {
    const email = String(value || "").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
  }

  function queueListingContact(propertyId) {
    if (appState.listingContacts.has(propertyId)) return;
    appState.listingContacts.set(propertyId, { loading: true });
    if (!backend?.configured) {
      appState.listingContacts.set(propertyId, { error: true });
      return;
    }
    backend.getPublishedListingContact(propertyId).then((contact) => {
      appState.listingContacts.set(propertyId, {
        name: contact?.contact_name ? String(contact.contact_name).trim() : "",
        phone: normalizeContactPhone(contact?.contact_phone),
        whatsapp: normalizeContactPhone(contact?.contact_whatsapp),
        email: validContactEmail(contact?.contact_email)
      });
      const { path } = routeInfo();
      if (path === `property/${propertyId}`) {
        main.innerHTML = propertyPage(propertyId);
      }
    }).catch(() => {
      appState.listingContacts.set(propertyId, { error: true });
      const { path } = routeInfo();
      if (path === `property/${propertyId}`) {
        main.innerHTML = propertyPage(propertyId);
      }
    });
  }

  function propertyContactMarkup(propertyId) {
    const localListing = currentListings().find((listing) => listing.id === propertyId && listing.localOnly);
    if (localListing?.contactPhone) {
      return `<p class="contact-person">${escapeHTML(localListing.contactName)}</p><div class="contact-actions"><a class="button button--primary button--full" href="tel:${escapeHTML(localListing.contactPhone)}">Call ${escapeHTML(localListing.contactName)}</a></div><p class="contact-disclaimer">This call link is part of a local preview listing. It is not available to other visitors unless the database is reconnected and the listing is published online.</p>`;
    }
    const contact = appState.listingContacts.get(propertyId);
    if (!contact) return `<p class="contact-disclaimer" role="status">Loading owner contact options…</p>`;
    if (contact.loading) return `<p class="contact-disclaimer" role="status">Loading owner contact options…</p>`;
    if (contact.error) return `<p class="contact-disclaimer" role="status">Contact options are temporarily unavailable. Please try again later.</p>`;
    const options = [];
    if (contact.phone) options.push(`<a class="button button--primary button--full" href="tel:${contact.phone}">Call ${escapeHTML(contact.name || "owner/agent")}</a>`);
    if (contact.whatsapp) {
      const digits = contact.whatsapp.slice(1);
      const message = encodeURIComponent("Hello, I'm interested in your property listed on EstateLink GH.");
      options.push(`<a class="button button--whatsapp button--full" href="https://wa.me/${digits}?text=${message}" target="_blank" rel="noopener noreferrer">Message on WhatsApp</a>`);
    }
    if (contact.email) {
      const mailto = contact.email.split("@").map((part) => encodeURIComponent(part).replace(/%2B/gi, "+")).join("@");
      options.push(`<a class="button button--outline button--full" href="mailto:${mailto}">Email ${escapeHTML(contact.name || "owner/agent")}</a>`);
    }
    if (!options.length) return `<p class="contact-disclaimer">The owner or agent has not shared contact options for this property.</p>`;
    return `${contact.name ? `<p class="contact-person">${escapeHTML(contact.name)}</p>` : ""}<div class="contact-actions">${options.join("")}</div><p class="contact-disclaimer">Contact details are shared by the property advertiser. Confirm property information before making a commitment.</p>`;
  }

  function listingStatusMarkup() {
    if (!appState.liveMode) {
      const hasLocalListings = currentListings().some((listing) => listing.localOnly);
      return `<div class="form-notice" role="status">${hasLocalListings
        ? "<strong>Local preview listings:</strong> These listings are saved only in this browser and are not visible to other visitors."
        : "The database is disconnected while the frontend is being completed. Live property listings are temporarily unavailable."}</div>`;
    }
    if (appState.listingsState === "loading") {
      return `<div class="form-notice" role="status">Loading live property listings…</div>`;
    }
    if (appState.listingsState === "error") {
      return `<div class="form-notice form-notice--warning" role="alert"><strong>Live listings could not be loaded.</strong> ${escapeHTML(appState.listingsError)} Check your connection, then try again. <button class="button button--small button--outline" type="button" data-action="retry-listings">Try again</button></div>`;
    }
    return "";
  }

  function requireSignInPage(forListing = false) {
    if (forListing) {
      return `<section class="container not-found"><span class="empty-state__icon" aria-hidden="true">↗</span><p class="eyebrow">FOR OWNERS & AGENTS</p><h1>Sign in to list a property</h1><p>Log in or create an account before preparing your property listing.</p><a class="button button--primary" href="${href("login?next=post")}">Log in</a><a class="button button--outline" href="${href("register?next=post")}">Create account</a></section>`;
    }
    return `<section class="container not-found"><span class="empty-state__icon" aria-hidden="true">↗</span><p class="eyebrow">YOUR ACCOUNT</p><h1>Sign in to continue</h1><p>Sign in to view and manage your account.</p><a class="button button--primary" href="${href("login")}">Log in</a></section>`;
  }

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;
    toast.setAttribute("role", "status");
    toast.textContent = message;
    toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  function routeInfo() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, search = ""] = raw.split("?");
    return { path: path || "home", params: new URLSearchParams(search) };
  }

  function imageMarkup(image, alt, className = "") {
    return `<img class="${className}" src="${escapeHTML(image)}" alt="${escapeHTML(alt)}" width="800" height="500" loading="lazy" decoding="async">`;
  }

  function propertyCard(listing) {
    const isFavorite = appState.favorites.has(listing.id);
    const label = listing.purpose === "Short Stay"
      ? "Short stay"
      : listing.purpose === "Buy"
        ? "For sale"
        : listing.purpose === "Rent"
          ? "For rent"
          : "";
    const isVerified = listing.verified === true ||
      listing.trustIndicators?.some((item) => item?.label === "Verified listing") === true;
    const details = [
      listing.bedrooms != null ? `${listing.bedrooms} beds` : "",
      listing.bathrooms != null ? `${listing.bathrooms} baths` : "",
      listing.size ? `${listing.size} m²` : ""
    ].filter(Boolean);
    return `
      <article class="property-card">
        <a class="property-card__image" href="${href(`property/${encodeURIComponent(listing.id)}`)}" aria-label="View ${escapeHTML(listing.title)}">
          ${imageMarkup(listing.image, listing.imagePlaceholder ? "No property photo provided" : listing.title)}
          ${isVerified ? `<span class="property-card__verified"><span aria-hidden="true">✓</span> Verified</span>` : ""}
          ${listing.featured === true ? `<span class="property-card__featured">Featured</span>` : ""}
          ${label ? `<span class="property-badge">${escapeHTML(label)}</span>` : ""}
        </a>
        <button class="favorite-button${isFavorite ? " is-favorite" : ""}" type="button" data-action="favorite" data-id="${escapeHTML(listing.id)}" aria-label="${isFavorite ? `Remove ${escapeHTML(listing.title)} from favorites` : `Save ${escapeHTML(listing.title)} to favorites`}" aria-pressed="${isFavorite}">
          <span aria-hidden="true">${isFavorite ? "♥" : "♡"}</span>
        </button>
        <a class="property-card__content" href="${href(`property/${encodeURIComponent(listing.id)}`)}" aria-label="View ${escapeHTML(listing.title)}">
          <div class="property-card__heading">
            <p class="property-card__category">${escapeHTML(listing.category)}</p>
            <p class="property-card__location">${escapeHTML([listing.neighborhood, listing.city, listing.region].filter(Boolean).join(", "))}</p>
          </div>
          <h3>${escapeHTML(listing.title)}</h3>
          ${details.length ? `<p class="property-card__meta">${details.map(escapeHTML).join('<span aria-hidden="true"> · </span>')}</p>` : ""}
          <div class="property-card__bottom">
            <p class="property-price">${money(listing.price, listing.currency)}${listing.period ? `<span> / ${escapeHTML(listing.period)}</span>` : ""}</p>
          </div>
        </a>
      </article>`;
  }

  function propertyGrid(listings, className = "") {
    return `<div class="property-grid ${className}">${listings.map(propertyCard).join("")}</div>`;
  }

  function sectionHeading(kicker, title, description = "", action = "") {
    return `<div class="section-heading"><div>${kicker ? `<p class="eyebrow">${escapeHTML(kicker)}</p>` : ""}<h2>${escapeHTML(title)}</h2>${description ? `<p class="muted">${escapeHTML(description)}</p>` : ""}</div>${action}</div>`;
  }

  function renderHeader(path) {
    const purpose = routeInfo().params.get("purpose");
    const links = [
      ["Buy", "browse?purpose=Buy", "Buy"],
      ["Rent", "browse?purpose=Rent", "Rent"],
      ["Short stays", "browse?purpose=Short%20Stay", "Short Stay"],
      ["Explore", "browse", ""]
    ];
    header.innerHTML = `
      <div class="container header-inner">
        <a class="brand" href="${href("home")}" aria-label="EstateLink GH home"><img class="brand-logo" src="assets/icons/icon-192.png" alt=""><span>Estate<span class="brand-light">Link</span> <span class="brand-region">GH</span></span></a>
        <button class="menu-toggle" type="button" aria-expanded="${appState.mobileMenuOpen}" aria-controls="primary-navigation" data-action="menu" aria-label="${appState.mobileMenuOpen ? "Close navigation" : "Open navigation"}"><span></span><span></span><span></span></button>
        <nav class="primary-nav${appState.mobileMenuOpen ? " is-open" : ""}" id="primary-navigation" aria-label="Main navigation">
          ${links.map(([label, route, filter]) => `<a class="${path === "browse" && (filter ? purpose === filter : !["Buy", "Rent", "Short Stay"].includes(purpose)) ? "is-active" : ""}" href="${href(route)}">${label}</a>`).join("")}
          ${!appState.appInstalled && appState.mobileDevice
            ? `<button class="install-app-link" type="button" data-action="install-app">Install EstateLink</button>`
            : ""}
          <a class="mobile-listing-link" href="${href("post")}">List your property</a>
          ${appState.user
            ? `<a class="mobile-account-link" href="${href("dashboard")}">My account</a><button class="mobile-account-link mobile-sign-out" type="button" data-action="sign-out">Log out</button>`
            : `<a class="mobile-account-link" href="${href("login")}">Sign in</a><a class="mobile-account-link" href="${href("register")}">Get started</a>`}
          <a class="mobile-account-link mobile-help-link" href="${href("help")}">Help & support</a>
        </nav>
        <div class="header-actions">
          ${appState.user
            ? `<a class="header-login" href="${href("dashboard")}">${escapeHTML(appState.user.user_metadata?.full_name || "My account")}</a><button class="button button--small button--outline" type="button" data-action="sign-out">Log out</button>`
            : `<a class="header-login" href="${href("login")}">Sign in</a><a class="header-get-started" href="${href("register")}">Get started</a><a class="button button--small button--primary header-listing-button" href="${href("post")}">List your property</a>`}
        </div>
      </div>`;
  }

  function renderFooter() {
    footer.innerHTML = `
      <div class="footer-cta">
        <div class="container footer-cta__inner">
          <div><p class="footer-eyebrow">YOUR NEXT MOVE STARTS HERE</p><h2>Find a place to call home.</h2><p>Explore homes across Ghana or share a property of your own.</p></div>
          <div class="footer-cta__actions"><a class="footer-button footer-button--primary" href="${href("browse")}">Browse properties <span aria-hidden="true">→</span></a><a class="footer-button" href="${href("post")}">List a property</a></div>
        </div>
      </div>
      <div class="footer-main container">
        <div class="footer-brand"><a class="brand brand--footer" href="${href("home")}" aria-label="EstateLink GH home"><img class="brand-logo" src="assets/icons/icon-192.png" alt=""><span>Estate<span class="brand-light">Link</span> <span class="brand-region">GH</span></span></a><p>A practical place to search published homes across Ghana.</p></div>
        <div class="footer-links"><h2>Discover</h2><a href="${href("browse?purpose=Buy")}">Buy a property</a><a href="${href("browse?purpose=Rent")}">Rent a property</a><a href="${href("browse?purpose=Short%20Stay")}">Short stays</a><a href="${href("favorites")}">Saved places</a><a href="${href("post")}">List a property</a></div>
        <div class="footer-links"><h2>EstateLink</h2><a href="${href("about")}">About us</a><a href="${href("safety")}">Safety Center</a><a href="${href("help")}">Help & support</a><a href="${href("terms")}">Terms & conditions</a><a href="${href("privacy")}">Privacy policy</a><a href="${href("contact")}">Contact us</a></div>
        <div class="footer-contact"><h2>Connect</h2><p>Property search, made clearer.</p><a href="${href("contact")}">Talk to our team <span aria-hidden="true">→</span></a></div>
      </div>
      <div class="footer-bottom"><div class="container"><span>© ${new Date().getFullYear()} EstateLink GH. All rights reserved.</span><span>Property information is supplied by listing advertisers.</span></div></div>`;
  }

  function searchForm(purpose = "Rent", compact = false) {
    return `
      <form class="search-form${compact ? " search-form--compact" : ""}" data-form="search">
        <label class="search-field search-field--location"><span>Location</span><input name="location" type="search" placeholder="City, neighborhood or region" autocomplete="off"></label>
        <label class="search-field"><span>Property type</span><select name="category"><option value="">Any type</option><option>Apartment</option><option>House</option><option>Land</option><option>Commercial</option><option>Short Stay</option><option>Other</option></select></label>
        <label class="search-field"><span>Min. budget (GHS)</span><input name="minPrice" type="number" min="0" inputmode="numeric" placeholder="Any"></label>
        <label class="search-field"><span>Max. budget (GHS)</span><input name="maxPrice" type="number" min="0" inputmode="numeric" placeholder="Any"></label>
        <input type="hidden" name="purpose" value="${escapeHTML(purpose)}">
        <div class="search-actions"><button class="button button--primary search-submit" type="submit"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3"></circle><path d="m15.5 15.5 4.2 4.2"></path></svg> Search homes</button><button class="search-reset" type="reset">Clear search</button></div>
        <p class="search-error" data-search-error role="alert" hidden></p>
      </form>`;
  }

  function homePage() {
    const featured = currentListings().filter((listing) => listing.featured === true).slice(0, 3);
    const recent = [...currentListings()].sort((a, b) => b.added.localeCompare(a.added)).slice(0, 3);
    const homeListings = featured.length ? featured : recent;
    const recentlyViewed = appState.recentlyViewed
      .map((id) => currentListings().find((listing) => listing.id === id))
      .filter(Boolean)
      .slice(0, 3);
    const listingContent = appState.listingsState === "loading" || appState.listingsState === "error"
      ? listingStatusMarkup()
      : currentListings().length
        ? `${listingStatusMarkup()}${propertyGrid(homeListings, "property-grid--home")}`
        : !appState.liveMode
          ? listingStatusMarkup()
          : `<div class="empty-state empty-state--listings"><h3>No published properties yet</h3><p>New homes will appear here after they have been reviewed and published.</p><a class="button button--outline" href="${href("post")}">List your property</a></div>`;
    const categories = data.categories.map((category) => `
      <a class="category-card" href="${href(`browse?${category.filter}=${encodeURIComponent(category.value)}`)}">
        ${imageMarkup(category.image, "")}<span class="category-card__shade"></span>
        <span class="category-card__content"><strong>${escapeHTML(category.name)}</strong><span>${escapeHTML(category.description)}</span></span>
      </a>`).join("");
    return `
      <section class="hero">
        <div class="hero__image" aria-hidden="true"></div>
        <div class="container hero__content"><p class="hero-kicker"><span></span> A PLACE TO BEGIN</p><h1>Find your place<br>in Ghana.</h1><p class="hero-copy">Explore properties across Ghana, from a home for the long term to somewhere for a short stay.</p>
          <div class="search-panel">
            <div class="purpose-tabs" role="group" aria-label="Choose listing purpose">
              <button type="button" aria-pressed="true" class="is-active" data-action="purpose" data-purpose="Rent">Rent</button>
              <button type="button" aria-pressed="false" data-action="purpose" data-purpose="Buy">Buy</button>
              <button type="button" aria-pressed="false" data-action="purpose" data-purpose="Short Stay">Short stay</button>
            </div>
            <div id="home-search">${searchForm()}</div>
          </div>
        </div>
      </section>
      <section class="section container categories-section">${sectionHeading("EXPLORE GHANA", "Start with the kind of place you need", "Choose a category to explore matching listings.")}<div class="category-grid">${categories}</div></section>
      <section class="section section--soft"><div class="container">${sectionHeading("ON ESTATELINK", featured.length ? "Featured properties" : "Properties to explore", featured.length ? "A selection of properties highlighted by their advertisers." : "Browse the latest property listings currently available on EstateLink.", `<a class="text-link" href="${href("browse")}">Explore all properties <span aria-hidden="true">→</span></a>`)}${listingContent}</div></section>
      ${recentlyViewed.length ? `<section class="section container recently-viewed-section">${sectionHeading("YOUR RECENTLY VIEWED", "Pick up where you left off", "Properties you opened on this device.", `<button class="text-link" type="button" data-action="clear-recent-history">Clear history</button>`)}${propertyGrid(recentlyViewed)}</section>` : ""}
      <section class="how-section"><div class="container how-layout"><div>${sectionHeading("A CLEARER WAY TO SEARCH", "Explore, compare, then connect.", "EstateLink brings property information shared by owners and agents into one place. Take time to review the details and make contact where options are available.")}<a class="button button--outline" href="${href("safety")}">Read our safety guidance</a></div><div class="steps-list"><article><span>01</span><div><h3>Search across Ghana</h3><p>Filter listings by location, property type, purpose, and budget.</p></div></article><article><span>02</span><div><h3>Explore the details</h3><p>Compare listing descriptions, photos, and information provided by advertisers.</p></div></article><article><span>03</span><div><h3>Contact the advertiser</h3><p>Use the contact options shown on a listing to ask questions or arrange a viewing. Always confirm important details directly.</p></div></article></div></div></section>
      <section class="owner-cta"><div class="container owner-cta__inner"><div><p class="eyebrow">FOR OWNERS & AGENTS</p><h2>Have a property to list?</h2><p>Sign in to submit a property for review. It will appear in search after it is published.</p></div><a class="button button--light" href="${href("post")}">List your property <span aria-hidden="true">→</span></a></div></section>`;
  }

  function browsePage(params) {
    const purpose = params.get("purpose") || "";
    const location = params.get("location") || "";
    const purposeLabel = purpose === "Short Stay" ? "short stays" : purpose.toLowerCase();
    const context = [purposeLabel, location].filter(Boolean);
    const supportedAmenities = [...new Set(currentListings().flatMap((listing) =>
      Array.isArray(listing.amenities) ? listing.amenities.filter((item) => typeof item === "string") : []
    ))].sort();
    const hasVerifiedListings = currentListings().some((listing) =>
      listing.verified === true || listing.trustIndicators?.some((item) => item?.label === "Verified listing")
    );
    return `
      <section class="page-hero page-hero--simple browse-hero"><div class="container"><p class="eyebrow">ESTATELINK GH · PROPERTY SEARCH</p><h1>Find properties in Ghana</h1><p id="browse-context">${context.length ? `Showing ${escapeHTML(context.join(" in "))}. Refine your search using location, property type, and budget.` : "Search published properties by location, purpose, type, and budget."}</p></div></section>
      <section class="container browse-search-section" aria-label="Search properties">
        <form class="browse-quick-search" data-form="browse-search">
          <label class="search-field"><span>Location</span><input id="browse-location-search" type="search" name="location" data-filter="location" placeholder="City, neighborhood, or region" autocomplete="off"></label>
          <label class="search-field"><span>Purpose</span><select name="purpose" data-filter="purpose"><option value="">Any purpose</option><option value="Rent">Rent</option><option value="Buy">Buy</option><option value="Short Stay">Short stay</option></select></label>
          <label class="search-field"><span>Property type</span><select name="category" data-filter="category"><option value="">Any type</option>${["Apartment", "House", "Land", "Commercial", "Short Stay", "Other"].map((option) => `<option value="${option}">${option}</option>`).join("")}</select></label>
          <label class="search-field"><span>Min. budget (GHS)</span><input type="number" min="0" inputmode="numeric" name="minPrice" data-filter="minPrice" placeholder="Any"></label>
          <label class="search-field"><span>Max. budget (GHS)</span><input type="number" min="0" inputmode="numeric" name="maxPrice" data-filter="maxPrice" placeholder="Any"></label>
          <button class="button button--primary browse-quick-search__submit" type="submit">Update search</button>
          <p class="browse-search-error" data-browse-search-error role="alert" hidden></p>
        </form>
        <nav class="browse-purpose-links" aria-label="Filter by listing purpose">
          <a class="${purpose === "" ? "is-active" : ""}" href="${href("browse")}">All homes</a>
          <a class="${purpose === "Rent" ? "is-active" : ""}" href="${href("browse?purpose=Rent")}">Rent</a>
          <a class="${purpose === "Buy" ? "is-active" : ""}" href="${href("browse?purpose=Buy")}">Buy</a>
          <a class="${purpose === "Short Stay" ? "is-active" : ""}" href="${href("browse?purpose=Short%20Stay")}">Short stays</a>
        </nav>
      </section>
      <section class="container browse-layout">
        <button class="browse-filter-toggle" type="button" data-action="toggle-browse-filters" aria-expanded="false" aria-controls="browse-filter-panel">More filters</button>
        <aside class="filter-panel" id="browse-filter-panel" aria-label="Additional property filters"><div class="filter-panel__heading"><h2>More filters</h2><button type="button" class="text-link" data-action="clear-filters">Clear all</button></div>
          <label class="field"><span>Region</span><select name="region" data-filter="region"><option value="">Any region</option>${["Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern", "Greater Accra", "Northern", "North East", "Oti", "Savannah", "Upper East", "Upper West", "Volta", "Western", "Western North"].map((option) => `<option>${option}</option>`).join("")}</select></label>
          <label class="field"><span>City or town</span><input type="search" name="city" data-filter="city" placeholder="e.g. Accra"></label>
          <label class="field"><span>Bedrooms</span><select data-filter="bedrooms"><option value="">Any</option><option value="1">1+ bedroom</option><option value="2">2+ bedrooms</option><option value="3">3+ bedrooms</option><option value="4">4+ bedrooms</option></select></label>
          <label class="field"><span>Bathrooms</span><select data-filter="bathrooms"><option value="">Any</option><option value="1">1+ bathroom</option><option value="2">2+ bathrooms</option><option value="3">3+ bathrooms</option></select></label>
          <div class="field-row"><label class="field"><span>Min. size (m²)</span><input type="number" min="0" inputmode="numeric" data-filter="minSize" placeholder="Any"></label><label class="field"><span>Max. size (m²)</span><input type="number" min="0" inputmode="numeric" data-filter="maxSize" placeholder="Any"></label></div>
          ${hasVerifiedListings || supportedAmenities.length ? `<fieldset class="checkbox-field"><legend>Listing details</legend>${hasVerifiedListings ? `<label><input type="checkbox" value="verified" data-filter="verified"> Verified listings</label>` : ""}${supportedAmenities.map((amenity) => `<label><input type="checkbox" value="${escapeHTML(amenity)}" data-filter="amenity">${escapeHTML(amenity)}</label>`).join("")}</fieldset>` : ""}
          <div class="filter-panel__actions"><button class="button button--primary" type="button" data-action="apply-browse-filters">Show results</button><button class="button button--outline" type="button" data-action="clear-filters">Clear filters</button></div>
        </aside>
        <div class="browse-results">${listingStatusMarkup()}<div class="browse-toolbar"><div><p class="eyebrow">SEARCH RESULTS</p><p id="result-count" aria-live="polite"></p></div><label class="sort-control"><span>Sort by</span><select data-filter="sort"><option value="recommended">Recommended</option><option value="newest">Newest first</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></label></div>
          <p id="budget-guidance" class="browse-budget-guidance" role="status" hidden></p>
          <div id="browse-grid" class="property-grid"></div><div id="browse-empty" class="empty-state" hidden><span class="empty-state__icon" aria-hidden="true">⌕</span><h2>No matching properties</h2><p>Try widening your search or removing a filter.</p><button class="button button--outline" data-action="clear-filters" type="button">Clear filters</button></div>
          <div class="load-more-wrap"><button id="load-more" class="button button--outline" type="button" data-action="load-more">Load more listings</button></div>
        </div>
      </section>`;
  }

  function propertyPage(id) {
    const listing = currentListings().find((item) => item.id === id);
    if (!listing && appState.listingsState === "loading") {
      return `<section class="container not-found"><p class="muted">Loading property details…</p></section>`;
    }
    if (!listing) return notFoundPage("This property is not currently published or could not be found.", "browse");
    const similar = currentListings()
      .filter((item) => item.id !== id)
      .map((item) => {
        const samePurpose = item.purpose === listing.purpose;
        const sameType = item.category === listing.category;
        const sameCity = Boolean(listing.city && item.city === listing.city);
        const sameRegion = Boolean(listing.region && item.region === listing.region);
        const withinPriceRange = listing.price > 0 && item.price >= listing.price * 0.7 && item.price <= listing.price * 1.3;
        return { item, score: Number(samePurpose) * 3 + Number(sameType) * 2 + Number(sameCity) * 3 + Number(sameRegion) + Number(withinPriceRange) };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ item }) => item);
    const images = (listing.images || [listing.image]).slice(0, 3);
    const isFavorite = appState.favorites.has(listing.id);
    return `
      <section class="container detail-page"><a class="back-link" href="${href("browse")}"><span aria-hidden="true">←</span> Back to properties</a>${listing.localOnly ? `<div class="form-notice" role="status"><strong>Published on this browser only.</strong> This listing is stored locally and is not online or visible to other visitors.</div>` : ""}
        <div class="detail-toolbar"><span class="detail-toolbar__trust">${trustStatusMarkup(listing)}</span><div><button class="button button--outline button--small detail-action${isFavorite ? " is-favorite" : ""}" type="button" data-action="favorite" data-id="${escapeHTML(listing.id)}" aria-label="${isFavorite ? "Remove from saved properties" : "Save property"}" aria-pressed="${isFavorite}"><span aria-hidden="true">${isFavorite ? "♥" : "♡"}</span> ${isFavorite ? "Saved" : "Save"}</button><button class="button button--outline button--small detail-action" type="button" data-action="share" data-id="${escapeHTML(listing.id)}">Share</button></div></div>
        <div class="detail-gallery${images.length === 1 ? " detail-gallery--single" : ""}">${images.map((image, index) => `<button type="button" class="gallery-image gallery-image--${index + 1}" data-action="gallery" data-src="${escapeHTML(image)}" aria-label="${listing.imagePlaceholder ? "No property photo provided" : `Open property photo ${index + 1}`}">${imageMarkup(image, listing.imagePlaceholder ? "No property photo provided" : `${listing.title}, photo ${index + 1}`)}</button>`).join("")}<span class="gallery-count">${listing.imagePlaceholder ? "No property photos supplied" : `${images.length} photos`}</span></div>
        <div class="detail-layout"><article class="detail-main"><p class="eyebrow">${escapeHTML(listing.purpose)} <span aria-hidden="true">·</span> ${escapeHTML(listing.category)}</p><h1>${escapeHTML(listing.title)}</h1><p class="detail-location"><span aria-hidden="true">⌖</span> ${escapeHTML(listing.address || locationText(listing))}</p><div class="detail-facts">${listing.bedrooms ? `<span><strong>${listing.bedrooms}</strong> bedrooms</span>` : ""}${listing.bathrooms ? `<span><strong>${listing.bathrooms}</strong> bathrooms</span>` : ""}${listing.size ? `<span><strong>${listing.size} m²</strong> property size</span>` : ""}</div>
          <section class="detail-section"><h2>Advertiser</h2><div class="advertiser"><span class="avatar" aria-hidden="true">${escapeHTML((listing.advertiser || "P").split(/\s+/).map((part) => part[0]).join("").slice(0, 2))}</span><div><strong>${escapeHTML(listing.advertiser || "Property advertiser")}</strong><span>${escapeHTML(listing.advertiserType || "Property advertiser")} · ${trustStatusMarkup(listing)}</span></div></div><p class="muted">Advertiser identity has not been independently verified.</p><a class="text-link" href="${href(`agent/${encodeURIComponent(listing.advertiser || "Property advertiser")}`)}">View advertiser profile <span aria-hidden="true">→</span></a></section>
          <section class="detail-section"><h2>About this property</h2><p>${escapeHTML(listing.description)}</p></section>
          ${listing.amenities.length ? `<section class="detail-section"><h2>Features & amenities</h2><ul class="amenities-list">${listing.amenities.map((amenity) => `<li><span aria-hidden="true">✓</span>${escapeHTML(amenity)}</li>`).join("")}</ul></section>` : ""}
          <section class="detail-section"><h2>Location</h2><p>${escapeHTML([listing.neighborhood, listing.city, listing.region].filter(Boolean).join(", "))}</p><p class="muted">Advertiser-provided location. Verify details before making a commitment.</p></section>
          <section class="safety-note"><h2>Stay safe</h2><p>Never send money before verifying the property and the person offering it. Meet in a safe location and verify important information before making payments.</p></section>
        </article>
        <aside class="contact-card"><p class="detail-price">${money(listing.price, listing.currency)}${listing.period ? `<span> / ${escapeHTML(listing.period)}</span>` : ""}</p><h2 class="contact-heading">Contact owner/agent</h2>${propertyContactMarkup(listing.id)}<button class="report-link" type="button" data-action="report" data-subject-type="listing" data-id="${escapeHTML(listing.id)}" data-name="${escapeHTML(listing.title)}">Report this listing</button></aside></div>
      </section>
      <section class="section section--soft"><div class="container">${sectionHeading("MORE TO EXPLORE", "Similar properties", "Listings selected by property type, location, purpose, and price.")}${similar.length ? propertyGrid(similar) : `<div class="empty-state"><h3>No similar published properties yet</h3><p>Try browsing all published listings to see more options.</p><a class="button button--outline" href="${href("browse")}">Browse properties</a></div>`}</div></section>`;
  }

  function postPage() {
    appState.selectedListingImages = [];
    appState.imagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    appState.imagePreviewUrls = [];
    const draft = ownerDraft();
    const content = `
      <section class="form-page"><div class="form-notice"><strong>Frontend preview mode:</strong> The database is disconnected. You can prepare and preview a property listing, but it will not be uploaded, submitted, or published.</div>
        ${draft.title || draft.description ? `<div class="preview-banner"><strong>Local draft restored</strong><span>This draft is stored in this browser only. Images are not saved in drafts.</span></div>` : ""}
        <form id="listing-form" class="listing-form" novalidate>
          <section class="form-section"><p class="form-step">01 <span>THE ESSENTIALS</span></p><h2>Start with the basics</h2>
            <label class="field"><span>Property title <b>*</b></span><input name="title" required maxlength="90" placeholder="e.g. Bright family home in East Legon" value="${escapeHTML(draft.title || "")}"><small>Choose a clear title that describes your property. <span data-counter-for="title">${(draft.title || "").length} / 90</span></small></label>
            <div class="field-row"><label class="field"><span>Property type <b>*</b></span><select name="category" required><option value="">Choose a type</option>${["Apartment", "House", "Land", "Commercial", "Short Stay", "Other"].map((value) => `<option${draft.category === value ? " selected" : ""}>${value}</option>`).join("")}</select></label><label class="field"><span>Listing purpose <b>*</b></span><select name="purpose" required><option value="">Choose a purpose</option>${["Rent", "Buy", "Short Stay"].map((value) => `<option${draft.purpose === value ? " selected" : ""}>${value}</option>`).join("")}</select></label></div>
            <label class="field"><span>Description <b>*</b></span><textarea name="description" required minlength="30" maxlength="3000" rows="5" placeholder="Describe the space, its setting, and what makes it special.">${escapeHTML(draft.description || "")}</textarea><small>At least 30 characters. Avoid including sensitive personal information. <span data-counter-for="description">${(draft.description || "").length} / 3000</span></small></label>
          </section>
          <section class="form-section"><p class="form-step">02 <span>PRICE & DETAILS</span></p><h2>Help people understand the space</h2>
            <div class="field-row"><label class="field"><span>Price <b>*</b></span><input name="price" required type="number" min="0" step="1" inputmode="numeric" placeholder="e.g. 6500" value="${escapeHTML(draft.price || "")}"></label><label class="field"><span>Currency</span><select name="currency"><option${(draft.currency || "GHS") === "GHS" ? " selected" : ""}>GHS</option><option${draft.currency === "USD" ? " selected" : ""}>USD</option></select></label></div>
            <div class="field-row"><label class="field"><span>Bedrooms</span><input name="bedrooms" type="number" min="0" max="50" inputmode="numeric" value="${escapeHTML(draft.bedrooms || "")}"></label><label class="field"><span>Bathrooms</span><input name="bathrooms" type="number" min="0" max="50" inputmode="numeric" value="${escapeHTML(draft.bathrooms || "")}"></label><label class="field"><span>Size (m²)</span><input name="size" type="number" min="0" inputmode="numeric" value="${escapeHTML(draft.size || "")}"></label></div>
            <label class="field"><span>Additional features</span><textarea name="features" rows="3" maxlength="500" placeholder="Optional features such as parking or outdoor space">${escapeHTML(draft.features || "")}</textarea><small>Features are preview-only until the existing property schema supports them.</small></label>
          </section>
          <section class="form-section"><p class="form-step">03 <span>LOCATION</span></p><h2>Where can people find it?</h2>
            <div class="field-row"><label class="field"><span>Country</span><input value="Ghana" readonly></label><label class="field"><span>Region <b>*</b></span><select name="region" required><option value="">Choose a region</option>${["Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern", "Greater Accra", "Northern", "North East", "Oti", "Savannah", "Upper East", "Upper West", "Volta", "Western", "Western North"].map((region) => `<option${draft.region === region ? " selected" : ""}>${region}</option>`).join("")}</select></label><label class="field"><span>City or town <b>*</b></span><input name="city" required placeholder="e.g. Accra" value="${escapeHTML(draft.city || "")}"></label></div>
            <label class="field"><span>Neighborhood</span><input name="neighborhood" placeholder="e.g. East Legon" value="${escapeHTML(draft.neighborhood || "")}"></label>
            <label class="field"><span>Address or location description</span><input name="addressDescription" maxlength="180" value="${escapeHTML(draft.addressDescription || "")}"><small>Shown in preview only; this field is not saved to the current property table.</small></label>
          </section>
          <section class="form-section"><p class="form-step">04 <span>CONTACT DETAILS</span></p><h2>How can renters reach you?</h2>
            <label class="field"><span>Contact name <b>*</b></span><input name="contactName" required maxlength="100" autocomplete="name" placeholder="Your name or agency name" value="${escapeHTML(draft.contactName || "")}"></label>
            <label class="field"><span>Phone number for calls <b>*</b></span><input name="contactPhone" required type="tel" autocomplete="tel" maxlength="24" placeholder="024 123 4567 or +233 24 123 4567" value="${escapeHTML(draft.contactPhone || "")}"><small>This will appear as a call button in the preview. Only add a number you intend to share with renters.</small></label>
            <p class="form-notice">Contact details are saved only in this browser when you save a local draft. The database is disconnected, so the number will not appear on a public listing yet.</p>
          </section>
          <section class="form-section"><p class="form-step">05 <span>PHOTOS & NEXT STEPS</span></p><h2>Show the property</h2>
            <label class="upload-box" for="property-images" data-drop-zone><span class="upload-icon" aria-hidden="true">↑</span><strong>Select or drop property photos</strong><span>Choose up to 8 JPEG, PNG, WebP, or AVIF images, up to 10 MB each. Photos are previewed in this browser only and are not uploaded.</span><input id="property-images" name="images" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple></label><div id="image-previews" class="image-previews" aria-live="polite"></div><p class="muted">Selected photos are temporary previews and are not saved with local drafts.</p>
            <div class="form-notice">Do not enter sensitive information in this preview.</div>
          </section>
          <div id="listing-errors" class="form-errors" role="alert" hidden></div>
          <div class="form-actions form-actions--listing"><button class="button button--outline" type="button" data-action="save-local-draft">Save draft on this device</button><button class="button button--primary" type="submit">Preview listing</button><p>Previewing does not submit or publish a listing. Drafts are stored only in this browser.</p></div>
        </form>
        <div id="listing-preview" class="listing-preview" hidden aria-live="polite"></div>
      </section>`;
    return `<section class="page-hero page-hero--simple"><div class="container"><p class="eyebrow">LIST A PROPERTY</p><h1>Prepare a property listing</h1><p>Complete the details and preview how your property could appear.</p></div></section><section class="container">${content}</section>`;
  }

  function authPage(kind) {
    const isLogin = kind === "login";
    if (!backend?.configured) {
      return `<section class="container not-found"><span class="empty-state__icon" aria-hidden="true">↗</span><p class="eyebrow">ACCOUNT</p><h1>Sign-in is temporarily unavailable</h1><p>The database connection is paused while the frontend is being completed. No account or password is needed to preview a property listing.</p><a class="button button--primary" href="${href("post")}">Prepare a listing preview</a><a class="button button--outline" href="${href("home")}">Return home</a></section>`;
    }
    const requestedNext = routeInfo().params.get("next");
    const next = ["post", "favorites"].includes(requestedNext) ? `?next=${requestedNext}` : "";
    const title = isLogin ? "Welcome back" : "Create your EstateLink account";
    return `
      <section class="auth-page"><div class="auth-decoration"><div class="auth-decoration__content"><img class="brand-logo brand-logo--large" src="assets/icons/icon-192.png" alt="EstateLink GH"><p class="eyebrow">A PLACE TO BEGIN</p><h2>Find your next chapter in Ghana.</h2><p>Explore homes, connect with advertisers and keep the places you love close.</p></div></div>
        <div class="auth-form-wrap"><form class="auth-form" data-form="account" data-kind="${kind}" novalidate><a class="back-link" href="${href("home")}">← Back to EstateLink</a><p class="eyebrow">${isLogin ? "YOUR ESTATELINK ACCOUNT" : "JOIN THE COMMUNITY"}</p><h1>${title}</h1><p class="muted">${isLogin ? "Sign in securely to manage your EstateLink account." : "Create an account to save places and submit properties."}</p>
          ${!isLogin ? `<label class="field"><span>Your name <b>*</b></span><input name="name" autocomplete="name" required></label><fieldset class="role-picker"><legend>I am joining as a <b>*</b></legend><label><input type="radio" name="role" value="owner" required checked><span>Property owner</span></label><label><input type="radio" name="role" value="agent" required><span>Real estate agent</span></label><p class="muted">Your current database trigger creates new profiles with the owner role. An administrator must approve any agent role change.</p></fieldset>` : ""}
          <label class="field"><span>Email address <b>*</b></span><input type="email" name="email" autocomplete="email" required placeholder="you@example.com"></label>
          <label class="field"><span>Password <b>*</b></span><input type="password" name="password" autocomplete="${isLogin ? "current-password" : "new-password"}" required minlength="8" placeholder="${isLogin ? "Enter your password" : "At least 8 characters"}"></label>
          ${!isLogin ? `<label class="consent-field"><input type="checkbox" name="terms" required><span>I have read and agree to the <a href="${href("terms")}">Terms &amp; Conditions</a>. Please also read the <a href="${href("privacy")}">Privacy Policy</a>. <b>*</b></span></label>` : ""}
          <div class="form-errors" role="alert" hidden></div><button type="submit" class="button button--primary button--full">${isLogin ? "Continue" : "Create account"}</button>
          <p class="auth-switch">${isLogin ? `New to EstateLink? <a href="${href(`register${next}`)}">Create an account</a>` : `Already have an account? <a href="${href(`login${next}`)}">Log in</a>`}</p>
          <p class="auth-note">${backend?.configured ? "Authentication is handled by Supabase. EstateLink does not store your password." : "Authentication is not configured yet. Do not enter a real password."}</p>
        </form></div></section>`;
  }

  function dashboardNav(active) {
    const links = [
      ["dashboard", "Overview"],
      ["my-properties", "My properties"],
      ["post", "Add property"],
      ["favorites", "Favorites"],
      ["messages", "Enquiries"],
      ["notifications", "Notifications"],
      ["profile", "Profile"],
      ["settings", "Settings"]
    ];
    return `<aside class="dashboard-nav" aria-label="Account navigation"><p class="eyebrow">OWNER WORKSPACE</p>${links.map(([route, label]) => `<a class="${active === route ? "is-active" : ""}" href="${href(route)}"${active === route ? ' aria-current="page"' : ""}>${label}</a>`).join("")}<a href="${href("help")}">Help & support</a><a href="${href("safety")}">Safety Center</a><button class="dashboard-signout" type="button" data-action="sign-out">Log out</button></aside>`;
  }

  function accountLayout(active, content) {
    const titles = {
      dashboard: "Owner dashboard",
      "my-properties": "My properties",
      favorites: "Saved places",
      profile: "Profile",
      settings: "Settings",
      messages: "Enquiries",
      notifications: "Notifications",
      post: "Add property",
      edit: "Edit property"
    };
    return `<section class="page-hero page-hero--simple"><div class="container"><p class="eyebrow">ESTATELINK OWNER WORKSPACE</p><h1>${titles[active] || "Your account"}</h1><p>Signed in as ${escapeHTML(appState.user?.email || "")}.</p></div></section><section class="container dashboard-layout">${dashboardNav(active)}<div class="dashboard-content">${content}</div></section>`;
  }

  function dashboardPage(listings = []) {
    const counts = Object.fromEntries(["published", "pending", "draft", "rejected"].map((status) => [status, listings.filter((listing) => normalizedStatus(listing) === status).length]));
    const localDraft = ownerDraft();
    const hasLocalDraft = Boolean(localDraft.title || localDraft.description || localDraft.city);
    const recent = [...listings].sort((a, b) => String(b.updatedAt || b.added || "").localeCompare(String(a.updatedAt || a.added || ""))).slice(0, 5);
    const recentMarkup = recent.map((listing) => `<article class="dashboard-property"><a class="dashboard-property__image" href="${href(`property/${encodeURIComponent(listing.id)}`)}">${imageMarkup(listing.image, listing.imagePlaceholder ? "No property photo provided" : listing.title)}</a><div><p class="eyebrow">${escapeHTML(listing.purpose)} · ${escapeHTML(locationText(listing))}</p><h2>${escapeHTML(listing.title)}</h2><p>${money(listing.price, listing.currency)}${listing.period ? ` / ${escapeHTML(listing.period)}` : ""} · ${statusBadge(normalizedStatus(listing))}</p></div><a class="button button--small button--outline" href="${href(`edit/${encodeURIComponent(listing.id)}`)}">Manage</a></article>`).join("");
    const content = `<div class="owner-welcome"><div><p class="eyebrow">ACCOUNT OVERVIEW</p><h2>Welcome${appState.user?.user_metadata?.full_name ? `, ${escapeHTML(appState.user.user_metadata.full_name)}` : ""}</h2><p>Keep your property details current and check the status of your submissions.</p></div><a class="button button--primary" href="${href("post")}">Add property</a></div><div class="stat-grid stat-grid--owner"><article class="stat-card"><span>Total properties</span><strong>${listings.length}</strong><small>In your account</small></article><article class="stat-card"><span>Published</span><strong>${counts.published}</strong><small>Visible to visitors</small></article><article class="stat-card"><span>Pending approval</span><strong>${counts.pending}</strong><small>Awaiting review</small></article><article class="stat-card"><span>Drafts</span><strong>${counts.draft + Number(hasLocalDraft)}</strong><small>${hasLocalDraft ? "Includes one local browser draft" : "Not submitted"}</small></article><article class="stat-card"><span>Rejected</span><strong>${counts.rejected}</strong><small>Review details</small></article></div><div class="owner-quick-actions"><a href="${href("post")}">Add property <span aria-hidden="true">→</span></a><a href="${href("my-properties")}">Manage properties <span aria-hidden="true">→</span></a><a href="${href("profile")}">Edit profile <span aria-hidden="true">→</span></a><a href="${href("profile-preview")}">Preview profile <span aria-hidden="true">→</span></a></div><div class="dashboard-panel"><div class="section-heading"><div><p class="eyebrow">RECENT ACTIVITY</p><h2>Recent properties</h2></div><a class="text-link" href="${href("my-properties")}">Manage all <span aria-hidden="true">→</span></a></div>${listings.length ? `<div class="dashboard-property-list">${recentMarkup}</div>` : `<div class="empty-state"><h2>Your property workspace is ready</h2><p>Start a listing when you’re ready. Submitted properties remain pending until an administrator publishes them.</p><a class="button button--outline" href="${href("post")}">Prepare a listing</a></div>`}${hasLocalDraft ? `<div class="local-draft-card"><div><span class="status-pill status-pill--draft">Local draft</span><h3>${escapeHTML(localDraft.title || "Untitled property")}</h3><p>Saved on this device only. Not submitted to EstateLink.</p></div><a class="button button--small button--outline" href="${href("post")}">Continue draft</a></div>` : ""}</div>`;
    return accountLayout("dashboard", content);
  }

  function myPropertiesPage(listings = []) {
    const filters = ["all", "published", "pending", "draft", "rejected"];
    const localDraft = ownerDraft();
    const hasLocalDraft = Boolean(localDraft.title || localDraft.description || localDraft.city);
    const content = `<div class="owner-properties-toolbar"><label class="field"><span>Search properties</span><input type="search" data-owner-search placeholder="Title, location or property type" value="${escapeHTML(appState.listingFilters.search)}"></label><label class="field"><span>Filter by status</span><select data-owner-status>${filters.map((status) => `<option value="${status}"${appState.listingFilters.status === status ? " selected" : ""}>${status === "all" ? "All statuses" : statusLabel(status)}</option>`).join("")}</select></label><a class="button button--primary" href="${href("post")}">Add property</a></div>${hasLocalDraft ? `<article class="local-draft-card"><div><span class="status-pill status-pill--draft">Local draft · this device</span><h2>${escapeHTML(localDraft.title || "Untitled property")}</h2><p>${escapeHTML([localDraft.neighborhood, localDraft.city, localDraft.region].filter(Boolean).join(", ") || "Location not entered")} · Not submitted</p></div><div class="dashboard-property__actions"><a class="button button--small button--outline" href="${href("post")}">Continue</a><button class="button button--small button--danger" type="button" data-action="delete-local-draft">Delete draft</button></div></article>` : ""}<div class="owner-listings-results" aria-live="polite"></div>${listings.length ? "" : `<div class="empty-state"><h2>No submitted properties yet</h2><p>Submit a property to see its review status and manage its details here.</p><a class="button button--primary" href="${href("post")}">Add property</a></div>`}`;
    return accountLayout("my-properties", content);
  }

  function initializeOwnerProperties(listings) {
    const container = document.querySelector(".owner-listings-results");
    if (!container) return;
    if (!listings.length) {
      container.innerHTML = "";
      return;
    }
    const draw = () => {
      const query = appState.listingFilters.search.trim().toLowerCase();
      const matches = listings.filter((listing) => {
        const status = normalizedStatus(listing);
        const searchText = `${listing.title} ${listing.category} ${listing.city} ${listing.region} ${listing.neighborhood}`.toLowerCase();
        return (appState.listingFilters.status === "all" || appState.listingFilters.status === status) &&
          (!query || searchText.includes(query));
      });
      container.innerHTML = matches.length
        ? `<div class="dashboard-property-list">${matches.map((listing) => {
          const status = normalizedStatus(listing);
          const actions = [
            `<a class="button button--small button--outline" href="${href(`edit/${encodeURIComponent(listing.id)}`)}">Edit</a>`,
            `<button class="button button--small button--outline" type="button" data-action="preview-owner-listing" data-id="${escapeHTML(listing.id)}">Preview</button>`,
            status === "published"
              ? `<a class="button button--small button--outline" href="${href(`property/${encodeURIComponent(listing.id)}`)}">View</a>`
              : "",
            `<button class="button button--small button--danger" type="button" data-action="delete-property" data-id="${escapeHTML(listing.id)}">Delete</button>`
          ].filter(Boolean).join("");
          const rejection = status === "rejected" && listing.rejectionReason
            ? `<p class="owner-rejection"><strong>Review note:</strong> ${escapeHTML(listing.rejectionReason)}</p>`
            : "";
          return `<article class="dashboard-property dashboard-property--managed"><a class="dashboard-property__image" href="${status === "published" ? href(`property/${encodeURIComponent(listing.id)}`) : "#"}">${imageMarkup(listing.image, listing.imagePlaceholder ? "No property photo provided" : listing.title)}</a><div class="dashboard-property__details"><p class="eyebrow">${escapeHTML(listing.purpose)} · ${escapeHTML(listing.category)}</p><h2>${escapeHTML(listing.title)}</h2><p>${escapeHTML(locationText(listing))} · ${money(listing.price, listing.currency)}${listing.period ? ` / ${escapeHTML(listing.period)}` : ""}</p><p>Created ${escapeHTML(listing.added || "Date unavailable")} · Updated ${escapeHTML(listing.updatedAt || listing.added || "Date unavailable")}</p><div>${statusBadge(status)}</div>${rejection}</div><div class="dashboard-property__actions">${actions}</div></article>`;
        }).join("")}</div>`
        : `<div class="empty-state owner-filter-empty"><h2>No matching properties</h2><p>Try another search or status filter.</p><button class="button button--outline" type="button" data-action="clear-owner-filters">Clear filters</button></div>`;
    };
    const search = document.querySelector("[data-owner-search]");
    const status = document.querySelector("[data-owner-status]");
    search?.addEventListener("input", () => {
      appState.listingFilters.search = search.value;
      draw();
    });
    status?.addEventListener("change", () => {
      appState.listingFilters.status = status.value;
      draw();
    });
    draw();
  }

  function favoritesPage() {
    const favorites = currentListings().filter((listing) => appState.favorites.has(listing.id));
    const content = `<div class="preview-banner"><strong>${appState.user ? "Account favorites" : "Session-only favorites"}</strong><span>${appState.user ? "Saved to your signed-in EstateLink account." : "Saved places clear when you reload or leave this page."}</span></div>${favorites.length ? propertyGrid(favorites) : `<div class="empty-state"><span class="empty-state__icon" aria-hidden="true">♡</span><h2>Your saved places will appear here</h2><p>Choose the heart on a property card to keep it handy${appState.user ? " in your account" : " for this page session"}.</p><a class="button button--outline" href="${href("browse")}">Browse properties</a></div>`}`;
    return appState.user
      ? accountLayout("favorites", content)
      : `<section class="page-hero page-hero--simple"><div class="container"><p class="eyebrow">YOUR SAVED PLACES</p><h1>Favorites</h1><p>Keep track of places you like during this visit.</p></div></section><section class="container info-page">${content}</section>`;
  }

  function editPage(listing) {
    if (!listing) return notFoundPage("This property could not be found in your account.", "my-properties");
    const content = `<div class="dashboard-panel"><form data-form="edit-listing" data-id="${escapeHTML(listing.id)}" class="edit-listing-form"><p class="form-notice"><strong>Editing ${escapeHTML(listing.title)}</strong> · ${statusBadge(normalizedStatus(listing))}. Status and owner association cannot be changed here.</p><p class="muted">The existing backend supports editing these saved property fields. Photos, additional features, and contact settings are managed separately and are not editable here yet.</p><label class="field"><span>Property title <b>*</b></span><input name="title" required maxlength="90" value="${escapeHTML(listing.title)}"></label><div class="field-row"><label class="field"><span>Property type</span><select name="category">${["Apartment", "House", "Land", "Commercial", "Short Stay", "Other"].map((value) => `<option${listing.category === value ? " selected" : ""}>${value}</option>`).join("")}</select></label><label class="field"><span>Listing purpose</span><select name="purpose">${["Rent", "Buy", "Short Stay"].map((value) => `<option${listing.purpose === value ? " selected" : ""}>${value}</option>`).join("")}</select></label></div><div class="field-row"><label class="field"><span>Price (${escapeHTML(listing.currency)}) <b>*</b></span><input name="price" required type="number" min="0" value="${escapeHTML(listing.price)}"></label><label class="field"><span>Currency</span><select name="currency"><option${listing.currency === "GHS" ? " selected" : ""}>GHS</option><option${listing.currency === "USD" ? " selected" : ""}>USD</option></select></label></div><label class="field"><span>Description <b>*</b></span><textarea name="description" required minlength="30" rows="5">${escapeHTML(listing.description)}</textarea></label><div class="field-row"><label class="field"><span>Country</span><input value="${escapeHTML(listing.country || "Ghana")}" readonly></label><label class="field"><span>Region</span><input name="region" maxlength="80" value="${escapeHTML(listing.region || "")}"></label><label class="field"><span>City</span><input name="city" maxlength="100" value="${escapeHTML(listing.city || "")}"></label></div><label class="field"><span>Neighborhood</span><input name="neighborhood" maxlength="100" value="${escapeHTML(listing.neighborhood || "")}"></label><div class="field-row"><label class="field"><span>Bedrooms</span><input name="bedrooms" type="number" min="0" max="50" value="${escapeHTML(listing.bedrooms || "")}"></label><label class="field"><span>Bathrooms</span><input name="bathrooms" type="number" min="0" max="50" value="${escapeHTML(listing.bathrooms || "")}"></label><label class="field"><span>Size (m²)</span><input name="size" type="number" min="0" value="${escapeHTML(listing.size || "")}"></label></div><p class="muted"><a class="text-link" href="${href("profile")}">Manage public contact information and sharing preferences</a></p><div class="form-errors" role="alert" hidden></div><div class="form-actions"><button class="button button--primary" type="submit">Save changes</button><a class="button button--outline" href="${href("my-properties")}">Cancel</a><button class="button button--danger" type="button" data-action="delete-property" data-id="${escapeHTML(listing.id)}">Delete listing</button></div></form></div>`;
    return accountLayout("my-properties", content);
  }

  function profilePage(profile = { full_name: "", role: "owner" }) {
    const content = `<div class="dashboard-panel"><form data-form="profile"><h2>Your profile</h2><div class="profile-photo-editor"><span class="avatar avatar--large" data-profile-photo-preview>${appState.profilePhotoUrl ? `<img src="${appState.profilePhotoUrl}" alt="Local profile photo preview">` : escapeHTML((profile.full_name || "P").split(/\s+/).map((part) => part[0]).join("").slice(0, 2))}</span><div><label class="field"><span>Profile photo</span><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" data-profile-photo></label><small>Local preview only. Profile photo upload is not connected to the account or public profile.</small></div></div><label class="field"><span>Contact person's name</span><input name="fullName" required maxlength="100" autocomplete="name" value="${escapeHTML(profile.full_name || "")}"></label>
      <fieldset class="contact-sharing"><legend>Contact details</legend><p>Enter details buyers and renters can use. Each method stays private unless you choose to share it on published listings.</p>
        <label class="field"><span>Phone number</span><input name="phone" type="tel" autocomplete="tel" maxlength="24" placeholder="024 123 4567 or +233 24 123 4567" value="${escapeHTML(profile.phone || "")}"></label>
        <label class="contact-opt-in"><input type="checkbox" name="publishContactPhone"${profile.publish_contact_phone ? " checked" : ""}><span>Show my phone number on published listings</span></label>
        <label class="field"><span>WhatsApp number <span class="muted">(optional)</span></span><input name="whatsappPhone" type="tel" autocomplete="tel" maxlength="24" placeholder="Use your phone number or enter a different one" value="${escapeHTML(profile.whatsapp_phone || "")}"></label>
        <label class="contact-opt-in"><input type="checkbox" name="publishContactWhatsapp"${profile.publish_contact_whatsapp ? " checked" : ""}><span>Show my WhatsApp number on published listings</span></label>
        <label class="field"><span>Contact email <span class="muted">(optional)</span></span><input name="contactEmail" type="email" autocomplete="email" maxlength="254" value="${escapeHTML(profile.public_contact_email || "")}"></label>
        <label class="contact-opt-in"><input type="checkbox" name="publishContactEmail"${profile.publish_contact_email ? " checked" : ""}><span>Show my contact email on published listings</span></label>
        <label class="contact-opt-in"><input type="checkbox" name="publishContactName"${profile.publish_contact_name ? " checked" : ""}><span>Show my name with these contact options</span></label>
      </fieldset>
      <section class="profile-preview" aria-label="Public contact preview"><p class="eyebrow">PUBLIC CONTACT PREVIEW</p><strong>${escapeHTML(profile.publish_contact_name && profile.full_name ? profile.full_name : "Property owner or agent")}</strong><div>${profile.publish_contact_phone && profile.phone ? `<span>Call: ${escapeHTML(profile.phone)}</span>` : ""}${profile.publish_contact_whatsapp && profile.whatsapp_phone ? `<span>WhatsApp: ${escapeHTML(profile.whatsapp_phone)}</span>` : ""}${profile.publish_contact_email && profile.public_contact_email ? `<span>Email: ${escapeHTML(profile.public_contact_email)}</span>` : ""}</div><small>This preview shows only contact details you have opted to share. Profile photo, biography, and public location are not connected to the current profile data.</small></section>
      <div class="readonly-details"><div><dt>Account email</dt><dd>${escapeHTML(appState.user?.email || "")}</dd></div><div><dt>Account type</dt><dd>${profile.role === "agent" ? "Real estate agent" : "Property owner"}</dd></div></div><p class="muted">Your account email and account type are managed through secure account settings. The contact email above is a separate optional public contact address.</p><div class="form-errors" role="alert" hidden></div><button class="button button--primary" type="submit">Save profile</button></form></div>`;
    return accountLayout("profile", content);
  }

  function settingsPage() {
    const profile = appState.profile || {};
    const content = `<div class="dashboard-panel"><p class="eyebrow">ACCOUNT</p><h2>Account details</h2><dl class="readonly-details"><div><dt>Name</dt><dd>${escapeHTML(profile.full_name || appState.user?.user_metadata?.full_name || "Not provided")}</dd></div><div><dt>Email address</dt><dd>${escapeHTML(appState.user?.email || "")}</dd></div><div><dt>Phone</dt><dd>${escapeHTML(profile.phone || "Not provided")}</dd></div><div><dt>Account type</dt><dd>${profile.role === "agent" ? "Real estate agent" : "Property owner"}</dd></div></dl><p class="muted">Update your public contact and privacy choices on your <a class="text-link" href="${href("profile")}">profile page</a>.</p></div><div class="dashboard-panel"><p class="eyebrow">PRIVACY</p><h2>Public visibility</h2><p class="muted">Phone, WhatsApp, and contact email are only shown when you opt in on your profile. Account email is not automatically shared.</p><a class="button button--outline" href="${href("profile")}">Review sharing preferences</a></div><div class="dashboard-panel"><p class="eyebrow">SECURITY</p><h2>Sign-in and access</h2><p class="muted">Password management is handled by Supabase Authentication. A password-change flow is not configured in this frontend yet.</p><button class="button button--danger" type="button" data-action="sign-out">Log out</button></div>`;
    return accountLayout("settings", content);
  }

  function profilePreviewPage(profile, listings = []) {
    const published = listings.filter((listing) => normalizedStatus(listing) === "published");
    const methods = [
      profile.publish_contact_phone && profile.phone ? `<a class="button button--primary" href="tel:${escapeHTML(normalizeContactPhone(profile.phone))}">Call</a>` : "",
      profile.publish_contact_whatsapp && profile.whatsapp_phone ? `<a class="button button--whatsapp" href="https://wa.me/${escapeHTML(normalizeContactPhone(profile.whatsapp_phone).slice(1))}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : "",
      profile.publish_contact_email && profile.public_contact_email ? `<a class="button button--outline" href="mailto:${escapeHTML(profile.public_contact_email)}">Email</a>` : ""
    ].filter(Boolean);
    const name = profile.publish_contact_name ? profile.full_name : "";
    const content = `<div class="preview-banner"><strong>Public profile preview</strong><span>Rendered from saved profile choices and your real published listings. Your account email is not included. This page is private to your signed-in account.</span></div><section class="public-profile-preview"><div class="public-profile-preview__identity"><span class="avatar avatar--large" aria-hidden="true">${appState.profilePhotoUrl ? `<img src="${appState.profilePhotoUrl}" alt="Local profile photo preview">` : escapeHTML((name || "EstateLink").split(/\s+/).map((part) => part[0]).join("").slice(0, 2))}</span><div><p class="eyebrow">${profile.role === "agent" ? "REAL ESTATE AGENT" : "PROPERTY OWNER"}</p><h2>${escapeHTML(name || "Property advertiser")}</h2><p>Ghana</p></div></div><div class="contact-actions">${methods.length ? methods.join("") : `<p class="muted">No contact methods are currently opted in for public display.</p>`}</div><p class="muted">A permanent public profile URL, photo upload, biography, public location, and public-profile visibility control are not supported by the current profile integration.</p></section><div class="dashboard-panel"><div class="section-heading"><div><p class="eyebrow">PUBLISHED LISTINGS</p><h2>Properties on your profile</h2></div></div>${published.length ? propertyGrid(published) : `<div class="empty-state"><h3>No published properties yet</h3><p>Your published listings will be associated with your public profile when the public profile backend is connected.</p><a class="button button--outline" href="${href("my-properties")}">Manage properties</a></div>`}</div>`;
    return accountLayout("profile", content);
  }

  function ownerMessagesPage() {
    const content = `<div class="empty-state"><h2>Messaging is not connected yet</h2><p>There are no enquiries to display. Property enquiries are not currently received or stored in an account inbox.</p><a class="button button--outline" href="${href("my-properties")}">View your properties</a></div>`;
    return accountLayout("messages", content);
  }

  function ownerNotificationsPage() {
    const content = `<div class="empty-state"><h2>Notifications are not connected yet</h2><p>There are no notifications to display. Check your properties page for current listing statuses.</p><a class="button button--outline" href="${href("my-properties")}">View your properties</a></div>`;
    return accountLayout("notifications", content);
  }

  function agentPage(advertiserName) {
    const agentName = advertiserName || "";
    const agentListings = currentListings().filter((listing) => listing.advertiser === agentName);
    if (!agentListings.length) return notFoundPage("No published properties are associated with this advertiser.", "browse");
    const initials = agentName.split(" ").map((part) => part[0]).join("");
    return `<section class="page-hero page-hero--simple"><div class="container"><p class="eyebrow">ADVERTISER</p><h1>${escapeHTML(agentName)}</h1><p>Advertiser profile · Ghana</p></div></section><section class="container profile-page"><div class="profile-intro"><span class="avatar avatar--large">${escapeHTML(initials)}</span><div><span class="status-pill">Not verified</span><h2>Properties advertised by ${escapeHTML(agentName)}</h2><p>Advertiser details are supplied with the listing and have not been independently verified by EstateLink.</p></div></div>${sectionHeading("PUBLISHED LISTINGS", "Properties from this advertiser")}${propertyGrid(agentListings)}<button class="report-link" type="button" data-action="report" data-subject-type="profile" data-id="${escapeHTML(agentName)}" data-name="${escapeHTML(agentName)}">Report profile</button> <a class="button button--outline" href="${href("contact")}">Contact EstateLink</a></section>`;
  }

  function adminPage(section = "overview") {
    const sections = [
      ["overview", "Dashboard"],
      ["properties", "Property management"],
      ["reports", "Report management"],
      ["users", "User management"],
      ["owners", "Owner & agent management"],
      ["moderation", "Moderation center"],
      ["activity", "Activity log"],
      ["settings", "Platform settings"]
    ];
    const active = sections.some(([key]) => key === section) ? section : "overview";
    const headings = {
      overview: ["Platform overview", "Platform totals, recent activity, and reports will appear when a protected admin data service is connected."],
      properties: ["Property management", "Review, search, filter, and moderate listings after server-authorized admin access is implemented."],
      reports: ["Report management", "Reported listings and investigation outcomes require a persisted report system and protected access."],
      users: ["User management", "Account records and account status controls require server-side authorization and carefully scoped data."],
      owners: ["Owner & agent management", "Listing counts, role details, and verification status require trusted backend data."],
      moderation: ["Moderation center", "Items requiring review will appear here after a secure moderation workflow is connected."],
      activity: ["Activity & audit log", "Administrator actions must be recorded by a trusted backend before they can be shown here."],
      settings: ["Platform settings", "Platform-wide configuration must be handled by a protected backend service."]
    };
    const overviewStats = ["Total users", "Total properties", "Published", "Pending", "Reported", "Suspended"];
    const [title, description] = headings[active];
    const empty = `<div class="admin-empty-state"><strong>Not connected</strong><p>No platform data is loaded and no administrative action is available in this frontend preview.</p></div>`;
    const body = active === "overview"
      ? `<div class="admin-stat-grid">${overviewStats.map((label) => `<article class="admin-stat"><span>${label}</span><strong>—</strong><small>Backend data not connected</small></article>`).join("")}</div><div class="admin-overview-grid"><section class="admin-panel"><h3>Recent activity</h3>${empty}</section><section class="admin-panel"><h3>Recent reports</h3>${empty}</section></div>`
      : `<section class="admin-panel"><div class="admin-table-heading"><h3>${escapeHTML(title)}</h3><span>Backend connection required</span></div>${empty}</section>`;
    return `<section class="page-hero page-hero--simple admin-hero"><div class="container"><p class="eyebrow">ADMINISTRATION · INTERFACE PREVIEW</p><h1>EstateLink administration</h1><p>Separate administrative workspace structure. It does not authenticate administrators or load platform records.</p></div></section><section class="container admin-layout"><aside class="admin-nav" aria-label="Administration navigation"><p class="eyebrow">ADMIN WORKSPACE</p>${sections.map(([key, label]) => `<a class="${active === key ? "is-active" : ""}" href="${href(`admin/${key}`)}"${active === key ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</aside><div class="admin-content"><div class="form-notice form-notice--warning" role="note"><strong>Preview only — not access control.</strong> This route is intentionally available without sign-in, exposes no user or property records, and has no moderation actions. It must not be used as a production admin panel.</div><div class="admin-page-heading"><p class="eyebrow">ADMINISTRATION</p><h2>${escapeHTML(title)}</h2><p>${escapeHTML(description)}</p></div>${body}<section class="admin-security-note"><h3>Required before production</h3><p>Implement server-side administrator authentication and authorization, enforce database access with appropriate Supabase RLS or trusted server functions, and record moderation actions in a protected audit log. A frontend role field or hidden link is not sufficient.</p></section></div></section>`;
  }

  function infoPage(kind) {
    const content = {
      about: {
        kicker: "ABOUT ESTATELINK", title: "Finding a place should feel like a fresh start.",
        intro: "EstateLink is a property discovery platform for Ghana — whether you are looking for a home to rent, a place to buy, or somewhere to stay for a while.",
        sections: [["Built around your search", "Explore homes by location, purpose, price and property type, with clear details to help you decide what feels right."], ["Made for the people behind the listing", "Property owners and real estate agents can submit a listing for review before it is made public."], ["A platform in progress", "Listings and advertiser identity are not independently verified. Check property details and terms directly before making a commitment."]]
      },
      help: {
        kicker: "HELP & SUPPORT", title: "Help with your EstateLink search.",
        intro: "Find answers about accounts, property listings, saved places, and contacting the EstateLink team.",
        sections: [["Your account", "Sign in to manage your profile, contact-sharing choices, saved properties, and listings submitted from your account. If you cannot access your account, use the password recovery option on the sign-in page when available in Supabase Auth."], ["Property listings", "Owners and agents can submit a property for review from the owner workspace. New listings are not public until their status is published. Keep your property details current and contact the team if you need help."], ["Saved properties", "Favorites are saved to your EstateLink account when you are signed in. While signed out, they are temporary for the current visit."], ["Contact support", "Use the Contact EstateLink form to send a message about the platform or a listing. Do not include passwords, payment details, or identity documents."], ["Reports", "Report controls are currently a frontend preview and do not transmit or store reports. For a safety concern, contact EstateLink through the contact form and include the listing link and relevant details."]]
      }
    }[kind];
    if (kind === "safety") {
      return `<section class="page-hero page-hero--simple"><div class="container"><p class="eyebrow">SAFETY CENTER</p><h1>Take time to verify before you commit.</h1><p>Use these practical checks when contacting an advertiser, viewing a property, or discussing payment.</p></div></section><section class="container info-page safety-center"><div class="info-sections"><article><span class="info-number">01</span><div><h2>Before contacting an owner</h2><ul><li>Review the listing details and available verification information.</li><li>Be cautious of unusually low prices or requests to move quickly.</li></ul></div></article><article><span class="info-number">02</span><div><h2>Before viewing</h2><ul><li>Confirm the location and agree on a safe meeting place.</li><li>Consider taking someone with you.</li><li>Confirm who you are dealing with and ask about their authority to advertise the property.</li></ul></div></article><article><span class="info-number">03</span><div><h2>Before paying</h2><ul><li>Verify ownership or authorization independently.</li><li>Understand all fees and put agreed terms in writing.</li><li>Do not allow pressure to rush a payment, and be cautious of unusual payment methods.</li></ul></div></article><article><span class="info-number">04</span><div><h2>If something feels suspicious</h2><ul><li>Stop communication if necessary and do not send money.</li><li>Report the listing or profile. Report forms are currently prototypes and are not transmitted or stored.</li><li>Contact EstateLink support with the listing link and details through the contact form.</li></ul></div></article></div><a class="button button--primary" href="${href("contact")}">Contact support</a></section>`;
    }
    return `<section class="page-hero page-hero--simple"><div class="container"><p class="eyebrow">${content.kicker}</p><h1>${content.title}</h1><p>${content.intro}</p></div></section><section class="container info-page"><div class="info-sections">${content.sections.map(([title, text], index) => `<article><span class="info-number">0${index + 1}</span><div><h2>${title}</h2><p>${text}</p></div></article>`).join("")}</div>${kind === "about" ? `<a class="button button--primary" href="${href("browse")}">Explore properties</a>` : `<div class="help-faq"><h2>Frequently asked questions</h2><details><summary>How do I submit a property?</summary><p>Sign in, choose “Add property”, complete the listing form, and submit it for review. It is not visible to visitors until published.</p></details><details><summary>Can I contact a property advertiser?</summary><p>Contact options appear on a property page only when the advertiser has chosen to share those details.</p></details><details><summary>Are listings or advertisers verified?</summary><p>EstateLink does not independently verify listings or advertiser identity in the current frontend. Review the details and make your own checks.</p></details><details><summary>How can I report an issue?</summary><p>Report controls are not connected to a reporting service yet. Contact the EstateLink team with the property link and relevant information.</p></details></div><a class="button button--outline" href="${href("safety")}">Visit the Safety Center</a><a class="button button--primary" href="${href("contact")}">Contact EstateLink</a>`}</section>`;
  }

  function legalPage(kind) {
    const isTerms = kind === "terms";
    const title = isTerms ? "Terms & Conditions" : "Privacy Policy";
    const sections = isTerms ? [
      ["1. About these terms", [
        "These terms describe use of the EstateLink GH website, a property discovery service. EstateLink GH is a service name; the full legal name of the person or company operating it and an official contact address have not been provided.",
        "By creating an account, you agree to these terms. If you do not agree, do not create an account or submit a listing. Visitors may browse public listings without an account."
      ]],
      ["2. EstateLink’s role", [
        "EstateLink provides tools to browse properties and to submit listings for review. Listing details, photographs, prices, availability, and advertiser claims are supplied by users and are not independently verified.",
        "EstateLink is not a party to a rental, sale, short-stay, or other agreement between users, and does not itself confirm ownership, authority to let or sell, property condition, title, or suitability. Do your own checks and obtain independent professional advice where appropriate."
      ]],
      ["3. Accounts and security", [
        "Provide accurate account details and keep your sign-in credentials secure. You are responsible for activity carried out through your account. Notify the service operator promptly if you believe your account has been used without permission.",
        "Accounts are for the individual or organisation they represent. Do not impersonate another person, misrepresent your authority, or use another person’s account without permission."
      ]],
      ["4. Listing submissions and content", [
        "You may submit a listing only if you are the owner or have permission to advertise it. Keep its title, description, price, location, property type, and other supplied details accurate and current.",
        "You must have the rights and permissions needed to submit photographs and other material. Do not submit unlawful, deceptive, discriminatory, infringing, or privacy-invasive content, or material that exposes sensitive personal information.",
        "A submitted listing is not public merely because it was submitted. New listings enter review and appear publicly only if approved and published. EstateLink may decline, remove, or request changes to content under its review process and applicable law.",
        "You retain your rights in content you submit. You grant EstateLink a limited, non-exclusive permission to store, review, format, and display that content as needed to operate the service and show a listing you submit. This permission ends when the content is removed, except where copies must be retained for legal, security, or operational reasons."
      ]],
      ["5. Contact and transactions", [
        "Users are responsible for independently verifying an advertiser, property, availability, price, and proposed agreement. Inspect the property or arrange a trusted representative, verify the advertiser’s authority, and put agreed terms in writing.",
        "Do not send money or sensitive documents until you have completed appropriate checks. EstateLink does not currently take payment, hold deposits, process bookings, or guarantee a transaction through this website. A contact or enquiry form may be a preview and may not send or store a message."
      ]],
      ["6. Acceptable use", [
        "Do not interfere with the service, attempt to access another user’s account or non-public data, bypass access controls, scrape or harvest information in a way that violates law or others’ rights, introduce malicious code, or use the service for fraud or unlawful discrimination.",
        "Do not use EstateLink to spam, threaten, harass, mislead, or unlawfully collect personal information from another person."
      ]],
      ["7. Availability, changes, and suspension", [
        "The service and its features may change or become unavailable. EstateLink may restrict or suspend access where reasonably necessary to protect users, investigate suspected misuse, comply with law, or maintain the service.",
        "You may stop using the service at any time. Account deletion and retention requests require an operational process to be confirmed by the service operator; do not assume that signing out deletes account data."
      ]],
      ["8. Disclaimers and liability", [
        "The service and listing content are provided subject to applicable law. EstateLink does not promise that listings are accurate, available, verified, or suitable, or that the website will always be uninterrupted or error-free.",
        "Nothing in these terms excludes or limits a right or liability that cannot lawfully be excluded or limited. Any other limitation of liability must be reviewed by the service operator’s legal adviser."
      ]],
      ["9. Governing law and contact", [
        "The service is intended for property searches in Ghana. The operator must confirm the governing-law, dispute-resolution, and notice provisions with a Ghana-qualified legal adviser and publish its legal identity and working contact details before these terms become final."
      ]]
    ] : [
      ["1. Who is responsible", [
        "EstateLink GH is the name of this property-search service. The full legal identity of the person or company responsible for the service and its privacy contact have not been provided. Contact the service through the Contact EstateLink form for privacy-related questions."
      ]],
      ["2. Information the service handles", [
        "The site is currently in frontend-only preview mode. Registration, sign-in, account, profile, database, and property-photo upload features are unavailable; the page does not send account credentials or account data to Supabase.",
        "The property form can be used to create a local preview, including a contact name and phone number displayed as a call link. Form text, including the contact number, can be saved in this browser using local storage; selected photos are only previewed in page memory and are not uploaded. The call link is not available to renters unless the listing is later connected and published. Do not save contact information on a shared device.",
        "Messages submitted through the contact form are sent to Formspree for delivery to the EstateLink operator. Listing reports are currently a frontend prototype and are not sent or stored. Do not include passwords, identity documents, payment details, or other sensitive information."
      ]],
      ["3. How information is used", [
        "Information entered in the property form is used to render a preview. If you save a draft, its text fields remain in local storage in this browser until you clear them. The site does not currently use this information to create or publish listings.",
        "The browser may make requests for decorative stock imagery and for delivery of a contact form submission. No analytics feature is described here because none was identified in the current frontend."
      ]],
      ["4. What becomes public", [
        "No user-submitted property listings or photos are uploaded or published in frontend-only mode. Decorative stock imagery may be loaded from Unsplash.",
        "The operator must update this notice if account, listing, profile, or photo-upload features are reconnected."
      ]],
      ["5. Service providers", [
        "The website uses Formspree to receive contact messages and may load decorative stock imagery from Unsplash. Netlify may host the testing deployment. Supabase is not currently loaded or contacted by the frontend.",
        "The operator should identify the applicable service-provider terms, processing roles, data locations, and any additional providers before publishing a final notice."
      ]],
      ["6. Retention and security", [
        "Local draft text, including a saved contact name and phone number, remains in browser storage until it is deleted by the visitor or browser. This frontend does not currently create server-side account, listing, profile, or favorite records.",
        "No website can guarantee absolute security. The operator should establish retention and deletion processes for any third-party contact form submissions and review hosting security before launch."
      ]],
      ["7. Your choices and privacy requests", [
        "You can browse the frontend without registering. You can remove a saved local draft from this browser using its browser storage controls. Account and profile controls are temporarily unavailable.",
        "The contact form sends submissions to Formspree for delivery to the EstateLink operator. Listing reports are currently a frontend prototype and are not sent or stored. Before launch, the operator must publish a monitored privacy contact and a process for access, correction, deletion, objection, and other applicable privacy requests, and confirm the rights that apply under relevant law."
      ]],
      ["8. Children and notice updates", [
        "The service is designed for people seeking or advertising property, not for children. Do not create an account if you are not legally able to agree to the applicable terms.",
        "The operator should date and publish updates to this notice and explain how material changes will be communicated. The effective date, responsible legal entity, contact information, retention periods, and governing-law details remain to be confirmed."
      ]]
    ];

    return `
      <section class="page-hero page-hero--simple">
        <div class="container">
          <p class="eyebrow">ESTATELINK GH · ${isTerms ? "TERMS" : "PRIVACY"}</p>
          <h1>${title}</h1>
          <p>${isTerms ? "Rules for using the EstateLink property-search service." : "What information the EstateLink website handles and what still needs to be confirmed."}</p>
        </div>
      </section>
      <section class="container info-page legal-page">
        <div class="legal-draft-note" role="note"><strong>Draft for review</strong><span>This is a working draft, not legal advice or a final legal notice. The operator’s legal identity, official contact details, and other items noted below must be confirmed and reviewed by a qualified lawyer before publication.</span></div>
        <div class="info-sections legal-sections">${sections.map(([heading, paragraphs], index) => `<article><span class="info-number">${String(index + 1).padStart(2, "0")}</span><div><h2>${heading}</h2>${paragraphs.map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`).join("")}</div></article>`).join("")}</div>
        <a class="button button--outline" href="${href("home")}">Back to EstateLink</a>
      </section>`;
  }

  function contactPage(params) {
    const listing = currentListings().find((item) => item.id === params.get("listing"));
    const via = params.get("via") === "whatsapp";
    const listingId = params.get("listing") || "";
    const subject = listing
      ? `EstateLink GH property enquiry: ${listing.title}`
      : "EstateLink GH website enquiry";
    return `<section class="page-hero page-hero--simple"><div class="container"><p class="eyebrow">WE’RE HERE TO HELP</p><h1>Contact EstateLink</h1><p>Send a message to the EstateLink team about the platform or a property listing.</p></div></section><section class="container contact-page">    <div class="contact-side"><img class="brand-logo brand-logo--large" src="assets/icons/icon-192.png" alt="EstateLink GH"><h2>Let’s talk.</h2><p>Questions about the platform or a property listing? Send us a message and the EstateLink team can follow up.</p></div><form class="contact-form" data-form="contact" novalidate><h2>Send us a message</h2>${listing ? `<div class="form-notice"><strong>Enquiry about:</strong> ${escapeHTML(listing.title)}${via ? " · WhatsApp contact requested" : ""}</div>` : ""}<input type="hidden" name="_subject" value="${escapeHTML(subject)}">${listingId ? `<input type="hidden" name="listing_id" value="${escapeHTML(listingId)}">` : ""}${listing ? `<input type="hidden" name="listing_title" value="${escapeHTML(listing.title)}">` : ""}<div class="contact-honeypot" aria-hidden="true"><label>Leave this field empty<input type="text" name="_gotcha" tabindex="-1" autocomplete="off"></label></div><label class="field"><span>Your name <b>*</b></span><input name="name" autocomplete="name" required maxlength="100"></label><label class="field"><span>Email address <b>*</b></span><input type="email" name="email" autocomplete="email" required maxlength="254"></label><label class="field"><span>What can we help with? <b>*</b></span><select name="topic" required><option value="">Choose a topic</option><option>General question</option><option>Listing enquiry</option><option>Safety concern</option><option>Technical issue</option></select></label><label class="field"><span>Your message <b>*</b></span><textarea name="message" required minlength="10" maxlength="3000" rows="5" placeholder="Tell us a little about your question."></textarea></label><div class="form-errors" role="alert" hidden></div><button class="button button--primary" type="submit">Send message</button><p class="auth-note">Your message and reply email are sent to the EstateLink team through Formspree. Do not include passwords, payment details, or other sensitive information.</p></form></section>`;
  }

  function notFoundPage(message, route = "browse") {
    return `<section class="container not-found"><span class="empty-state__icon" aria-hidden="true">⌕</span><p class="eyebrow">NOT FOUND</p><h1>Let’s find another way.</h1><p>${escapeHTML(message)}</p><a class="button button--primary" href="${href(route)}">Continue to ${route === "browse" ? "browse properties" : "your properties"}</a></section>`;
  }

  function render() {
    const { path, params } = routeInfo();
    const [section, ...parts] = path.split("/");
    const privateSection = ["dashboard", "my-properties", "edit", "profile", "profile-preview", "messages", "notifications", "settings"].includes(section);
    appState.mobileMenuOpen = false;
    const routes = {
      home: () => homePage(),
      browse: () => browsePage(params),
      property: () => propertyPage(decodeURIComponent(parts.join("/"))),
      post: () => postPage(),
      login: () => authPage("login"),
      register: () => authPage("register"),
      dashboard: () => dashboardPage(),
      "my-properties": () => myPropertiesPage(),
      edit: () => editPage(currentListings().find((item) => item.id === decodeURIComponent(parts.join("/")))),
      favorites: () => favoritesPage(),
      agent: () => agentPage(decodeURIComponent(parts.join("/"))),
      "public-profile": () => agentPage(decodeURIComponent(parts.join("/"))),
      profile: () => profilePage(),
      "profile-preview": () => profilePreviewPage(appState.profile || {}, []),
      settings: () => settingsPage(),
      messages: () => ownerMessagesPage(),
      notifications: () => ownerNotificationsPage(),
      admin: () => adminPage(parts[0]),
      about: () => infoPage("about"),
      contact: () => contactPage(params),
      help: () => infoPage("help"),
      safety: () => infoPage("safety"),
      terms: () => legalPage("terms"),
      privacy: () => legalPage("privacy")
    };
    const pageTitle = {
      home: "Find your place in Ghana",
      terms: "Terms & Conditions",
      privacy: "Privacy Policy"
    }[section] || (section === "property"
      ? currentListings().find((item) => item.id === parts[0])?.title || "Property details"
      : (section || "Page").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()));
    document.title = `${pageTitle} | EstateLink GH`;
    renderHeader(section);
    renderFooter();
    if (privateSection) {
      if (!backend?.configured) {
        main.innerHTML = `<section class="container not-found"><span class="empty-state__icon" aria-hidden="true">↗</span><p class="eyebrow">OWNER WORKSPACE</p><h1>Account features are temporarily unavailable</h1><p>The database connection is paused, so sign-in, profile, and saved account data are not available. Your local listing drafts remain on this device.</p><a class="button button--primary" href="${href("post")}">Prepare a listing preview</a><a class="button button--outline" href="${href("home")}">Return home</a></section>`;
      } else if (!appState.authReady) {
        main.innerHTML = `<section class="container not-found"><p class="muted">Checking your secure session…</p></section>`;
      } else if (!appState.user) {
        main.innerHTML = requireSignInPage(section === "post");
      } else if (section === "post" || section === "profile-preview") {
        main.innerHTML = `<section class="container not-found"><p class="muted">Loading your profile…</p></section>`;
        loadAccountRoute(section, "");
      } else if (["messages", "notifications"].includes(section)) {
        if (section === "messages") main.innerHTML = ownerMessagesPage();
        else if (section === "notifications") main.innerHTML = ownerNotificationsPage();
      } else {
        main.innerHTML = `<section class="container not-found"><p class="muted">Loading your account…</p></section>`;
        loadAccountRoute(section, decodeURIComponent(parts.join("/")));
      }
    } else {
      main.innerHTML = (routes[section] || (() => notFoundPage("The page you’re looking for isn’t available.")))();
    }
    if (section === "property") {
      const propertyId = decodeURIComponent(parts.join("/"));
      if (currentListings().some((listing) => listing.id === propertyId)) rememberListing(propertyId);
      queueListingContact(propertyId);
    }
    main.focus({ preventScroll: true });
    if (section === "browse") initializeBrowse(params);
    window.scrollTo(0, 0);
  }

  async function loadAccountRoute(section, id) {
    const userId = appState.user?.id;
    try {
      if (["profile", "settings", "profile-preview", "post"].includes(section)) {
        const profile = await backend.getProfile();
        if (appState.user?.id !== userId) return;
        appState.profile = profile || {};
        if (section === "profile") main.innerHTML = profile
          ? profilePage(profile)
          : accountLayout("profile", `<div class="form-notice form-notice--warning">Your profile record is missing. Ask the administrator to check the database setup.</div>`);
        else if (section === "settings") main.innerHTML = settingsPage();
        else if (section === "profile-preview") {
          const listings = await backend.getMyListings();
          if (appState.user?.id !== userId) return;
          main.innerHTML = profilePreviewPage(profile || {}, listings);
        } else main.innerHTML = postPage();
      } else {
        const listings = await backend.getMyListings();
        if (appState.user?.id !== userId) return;
        if (section === "dashboard") main.innerHTML = dashboardPage(listings);
        else if (section === "my-properties") {
          main.innerHTML = myPropertiesPage(listings);
          initializeOwnerProperties(listings);
        }
        else if (section === "edit") {
          const listing = listings.find((item) => item.id === id);
          main.innerHTML = listing ? editPage(listing) : notFoundPage("This property could not be found in your account.", "my-properties");
        }
      }
    } catch (error) {
      main.innerHTML = accountLayout(
        section === "edit" ? "my-properties" : section,
        `<div class="form-notice form-notice--warning" role="alert"><strong>Your account data could not be loaded.</strong> ${escapeHTML(error.message)}</div>`
      );
    }
  }

  function initializeBrowse(params) {
    const filters = [...document.querySelectorAll("[data-filter]")];
    filters.forEach((filter) => {
      const values = params.getAll(filter.dataset.filter);
      if (filter.type === "checkbox") filter.checked = values.includes(filter.value);
      else if (values.length) filter.value = values[0];
    });
    let shownCount = 6;
    const normalizeText = (value) => String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    const numericValue = (value) => {
      if (value === "" || value == null) return null;
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? number : null;
    };
    const filterValues = () => {
      const values = new URLSearchParams();
      filters.forEach((filter) => {
        if (filter.type === "checkbox") {
          if (filter.checked) values.append(filter.dataset.filter, filter.value);
        } else if (filter.value && !(filter.dataset.filter === "sort" && filter.value === "recommended")) {
          values.set(filter.dataset.filter, filter.value.trim());
        }
      });
      return values;
    };
    const updateRoute = () => {
      const query = filterValues().toString();
      const route = query ? `/browse?${query}` : "/browse";
      history.replaceState(history.state, "", `${location.pathname}${location.search}#${route}`);
    };
    const update = (reset = true) => {
      if (reset) shownCount = 6;
      const value = (name) => document.querySelector(`[data-filter="${name}"]`)?.value.trim() || "";
      const locationSearch = normalizeText(value("location"));
      const region = normalizeText(value("region"));
      const city = normalizeText(value("city"));
      const purpose = value("purpose");
      const category = value("category");
      const minInput = value("minPrice");
      const maxInput = value("maxPrice");
      const minPrice = minInput ? numericValue(minInput) : null;
      const maxPrice = maxInput ? numericValue(maxInput) : null;
      const bedrooms = numericValue(value("bedrooms")) || 0;
      const bathrooms = numericValue(value("bathrooms")) || 0;
      const minSize = numericValue(value("minSize"));
      const maxSize = numericValue(value("maxSize"));
      const verifiedOnly = Boolean(document.querySelector('[data-filter="verified"]')?.checked);
      const amenities = [...document.querySelectorAll('[data-filter="amenity"]:checked')].map((item) => item.value);
      const sort = value("sort");
      const invalidPriceRange = Boolean(
        (minInput && minPrice === null) ||
        (maxInput && maxPrice === null) ||
        (minPrice !== null && maxPrice !== null && maxPrice < minPrice)
      );
      const hasBudget = Boolean(minInput || maxInput);
      const comparableBudget = hasBudget && Boolean(purpose);
      const budgetGuidance = document.querySelector("#budget-guidance");
      const context = document.querySelector("#browse-context");
      const purposeLabel = purpose === "Short Stay" ? "short stays" : purpose.toLowerCase();
      const contextParts = [purposeLabel, value("location")].filter(Boolean);
      context.textContent = contextParts.length
        ? `Showing ${contextParts.join(" in ")}. Refine your search using location, property type, and budget.`
        : "Search published properties by location, purpose, type, and budget.";
      budgetGuidance.hidden = !hasBudget && sort !== "price-low" && sort !== "price-high";
      budgetGuidance.textContent = hasBudget && !purpose
        ? "Choose Buy, Rent, or Short stay to apply a budget. This keeps sale prices, monthly rent, and nightly rates from being compared as if they were the same."
        : hasBudget
          ? "Budget filters are in GHS and only compare listings with the selected purpose and billing period."
          : sort === "price-low" || sort === "price-high"
            ? "Price sorting keeps currencies and billing periods in separate groups."
            : "";
      const expectedPeriod = purpose === "Rent" ? "month" : purpose === "Short Stay" ? "night" : "";
      const matchesBudget = (listing) => {
        if (!hasBudget || !comparableBudget) return true;
        if (String(listing.currency || "GHS").toUpperCase() !== "GHS") return false;
        if (listing.period && listing.period !== expectedPeriod) return false;
        const price = numericValue(listing.price);
        return price !== null && (minPrice === null || price >= minPrice) && (maxPrice === null || price <= maxPrice);
      };
      let matches = invalidPriceRange ? [] : currentListings().filter((listing) => {
        const searchableLocation = normalizeText([
          listing.country, listing.region, listing.city, listing.neighborhood, listing.address
        ].filter(Boolean).join(" "));
        const price = numericValue(listing.price);
        const listingSize = numericValue(listing.size);
        return (!locationSearch || searchableLocation.includes(locationSearch)) &&
          (!region || normalizeText(listing.region) === region) &&
          (!city || normalizeText(listing.city).includes(city)) &&
          (!purpose || listing.purpose === purpose) &&
          (!category || listing.category === category) &&
          matchesBudget(listing) &&
          (!bedrooms || (numericValue(listing.bedrooms) !== null && numericValue(listing.bedrooms) >= bedrooms)) &&
          (!bathrooms || (numericValue(listing.bathrooms) !== null && numericValue(listing.bathrooms) >= bathrooms)) &&
          (minSize === null || (listingSize !== null && listingSize >= minSize)) &&
          (maxSize === null || (listingSize !== null && listingSize <= maxSize)) &&
          (!verifiedOnly || listing.verified === true || listing.trustIndicators?.some((item) => item?.label === "Verified listing")) &&
          amenities.every((amenity) => Array.isArray(listing.amenities) && listing.amenities.includes(amenity));
      });
      if (sort === "newest") {
        matches = [...matches].sort((a, b) => {
          const first = Date.parse(a.added || "");
          const second = Date.parse(b.added || "");
          if (!Number.isFinite(first)) return Number.isFinite(second) ? 1 : 0;
          if (!Number.isFinite(second)) return -1;
          return second - first;
        });
      }
      if (sort === "price-low" || sort === "price-high") {
        const direction = sort === "price-low" ? 1 : -1;
        const priceGroup = (listing) =>
          `${String(listing.currency || "GHS").toUpperCase()}|${listing.purpose || ""}|${listing.period || ""}`;
        matches = [...matches].sort((a, b) =>
          priceGroup(a).localeCompare(priceGroup(b)) ||
          direction * ((numericValue(a.price) ?? 0) - (numericValue(b.price) ?? 0))
        );
      }
      const resultCount = document.querySelector("#result-count");
      resultCount.textContent = invalidPriceRange
        ? "Check your budget range"
        : appState.listingsState === "loading"
          ? "Loading properties…"
          : appState.listingsState === "error"
            ? "Listings unavailable"
            : `${matches.length} ${matches.length === 1 ? "property" : "properties"} found`;
      document.querySelector("#browse-grid").innerHTML = propertyGrid(matches.slice(0, shownCount));
      const emptyState = document.querySelector("#browse-empty");
      const isWaiting = ["loading", "error"].includes(appState.listingsState);
      const shouldShowEmpty = !isWaiting &&
        (invalidPriceRange || matches.length === 0 || (!currentListings().length && appState.listingsState === "ready"));
      emptyState.hidden = !shouldShowEmpty;
      if (shouldShowEmpty) {
        emptyState.querySelector("h2").textContent = invalidPriceRange
          ? "Check your budget range"
          : !currentListings().length
            ? appState.liveMode ? "No published properties yet" : "No local preview listings yet"
            : "No matching properties";
        emptyState.querySelector("p").textContent = invalidPriceRange
          ? "The maximum budget must be greater than or equal to the minimum budget."
          : !currentListings().length
            ? appState.liveMode
              ? "New homes will appear here when published property listings are available."
              : "Create a local listing preview to see how properties appear in search. It will not be online or visible to other visitors."
            : "Try widening your search or removing a filter.";
      }
      const loadMore = document.querySelector("#load-more");
      loadMore.hidden = isWaiting || matches.length <= shownCount;
      appState.loadMore = matches.length > shownCount
        ? () => { shownCount += 6; update(false); }
        : null;
      document.querySelector("[data-action='retry-listings']")?.toggleAttribute("hidden", appState.listingsState !== "error");
      document.querySelector(".browse-filter-toggle").setAttribute(
        "aria-label",
        `More filters${filters.some((filter) => filter.dataset.filter !== "sort" && (filter.type === "checkbox" ? filter.checked : Boolean(filter.value))) ? ", active filters applied" : ""}`
      );
      const hasActiveFilters = filters.some((filter) =>
        filter.dataset.filter !== "sort" &&
        (filter.type === "checkbox" ? filter.checked : Boolean(filter.value))
      );
      document.querySelectorAll("[data-action='clear-filters']").forEach((button) => {
        button.hidden = !hasActiveFilters;
      });
      updateRoute();
    };
    appState.browseUpdate = update;
    filters.forEach((filter) => {
      filter.addEventListener("input", () => update());
      filter.addEventListener("change", () => update());
    });
    update();
  }

  function showErrors(container, messages) {
    container.className = "form-errors";
    container.setAttribute("role", "alert");
    container.innerHTML = `<strong>Please check the following:</strong><ul>${messages.map((message) => `<li>${escapeHTML(message)}</li>`).join("")}</ul>`;
    container.hidden = false;
    container.focus?.();
  }

  function showFormSuccess(container, message) {
    container.className = "form-message form-message--success";
    container.setAttribute("role", "status");
    container.textContent = message;
    container.hidden = false;
  }

  function renderImagePreviews(input) {
    const preview = document.querySelector("#image-previews");
    if (!preview) return;
    appState.imagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    appState.imagePreviewUrls = [];
    preview.innerHTML = appState.selectedListingImages.map((file, index) => {
      const url = URL.createObjectURL(file);
      appState.imagePreviewUrls.push(url);
      return `<article class="image-preview"><img src="${url}" alt="Selected property photo ${index + 1}: ${escapeHTML(file.name)}" loading="lazy"><div class="image-preview__meta"><strong>${index === 0 ? "Featured photo" : `Photo ${index + 1}`}</strong><span>${escapeHTML(file.name)}</span></div><div class="image-preview__actions"><button type="button" class="button button--small button--outline" data-action="feature-photo" data-index="${index}"${index === 0 ? " disabled" : ""}>Set featured</button><button type="button" class="button button--small button--outline" data-action="move-photo" data-index="${index}" data-direction="-1"${index === 0 ? " disabled" : ""} aria-label="Move photo ${index + 1} earlier">Move up</button><button type="button" class="button button--small button--outline" data-action="move-photo" data-index="${index}" data-direction="1"${index === appState.selectedListingImages.length - 1 ? " disabled" : ""} aria-label="Move photo ${index + 1} later">Move down</button><button type="button" class="button button--small button--danger" data-action="remove-photo" data-index="${index}">Remove</button></div></article>`;
    }).join("");
  }

  function syncSelectedImages(input) {
    const transfer = new DataTransfer();
    appState.selectedListingImages.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    renderImagePreviews(input);
  }

  function saveLocalListingDraft(form) {
    const data = new FormData(form);
    const draft = {};
    ["title", "category", "purpose", "description", "price", "currency", "bedrooms", "bathrooms", "size", "features", "region", "city", "neighborhood", "addressDescription", "contactName", "contactPhone"].forEach((key) => {
      draft[key] = String(data.get(key) || "");
    });
    try {
      localStorage.setItem(ownerDraftStorageKey(), JSON.stringify(draft));
      showToast("Draft saved on this device. It has not been submitted.", "success");
      return true;
    } catch (error) {
      showToast(`Draft could not be saved on this device: ${error.message}`);
      return false;
    }
  }

  function handleListingSubmit(form) {
    const errors = [];
    const title = form.elements.title.value.trim();
    const description = form.elements.description.value.trim();
    const contactName = form.elements.contactName.value.trim();
    const contactPhone = normalizeContactPhone(form.elements.contactPhone.value);
    if (!title) errors.push("Add a property title.");
    if (!form.elements.category.value) errors.push("Choose a property type.");
    if (!form.elements.purpose.value) errors.push("Choose a listing purpose.");
    if (description.length < 30) errors.push("Describe the property in at least 30 characters.");
    if (form.elements.price.value === "" || Number(form.elements.price.value) < 0) errors.push("Enter a price of zero or greater.");
    if (!form.elements.region.value || !form.elements.city.value.trim()) errors.push("Choose a region and enter a city or town.");
    if (!contactName) errors.push("Enter a contact name renters can ask for.");
    if (!contactPhone) errors.push("Enter a valid phone number renters can call, such as 024 123 4567 or +233 24 123 4567.");
    const files = appState.selectedListingImages.length
      ? [...appState.selectedListingImages]
      : [...form.elements.images.files];
    if (files.length > 8) errors.push("Choose no more than 8 photos.");
    if (files.some((file) => !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type))) errors.push("Choose JPEG, PNG, WebP, or AVIF images only.");
    if (files.some((file) => file.size > 10 * 1024 * 1024)) errors.push("Each photo must be 10 MB or smaller.");
    const errorBox = document.querySelector("#listing-errors");
    if (errors.length) {
      showErrors(errorBox, errors);
      form.querySelector(":invalid")?.focus();
      return;
    }
    errorBox.hidden = true;
    const formData = new FormData(form);
    const purpose = formData.get("purpose");
    const preview = document.querySelector("#listing-preview");
    preview.innerHTML = `<div class="preview-banner"><strong>Listing preview — not published</strong><span>This preview is not online yet. Publishing below saves it to this browser only while the database is disconnected.</span></div><article class="listing-preview__card">${files.length ? `<div class="preview-photo-row">${files.map((file, index) => { const url = appState.imagePreviewUrls[index] || URL.createObjectURL(file); if (!appState.imagePreviewUrls[index]) appState.imagePreviewUrls[index] = url; return `<img src="${url}" alt="${index ? "Property photo" : "Featured property photo"}">`; }).join("")}</div>` : `<div class="empty-state"><h3>No property photos selected</h3><p>You can add photos before submitting.</p></div>`}<div class="listing-preview__content"><p class="eyebrow">${escapeHTML(purpose)} · ${escapeHTML(formData.get("category"))}</p><h2>${escapeHTML(title)}</h2><p class="muted">${escapeHTML([formData.get("addressDescription"), formData.get("neighborhood"), formData.get("city"), formData.get("region"), "Ghana"].filter(Boolean).join(", "))}</p><div class="detail-facts">${formData.get("bedrooms") ? `<span><strong>${escapeHTML(formData.get("bedrooms"))}</strong> bedrooms</span>` : ""}${formData.get("bathrooms") ? `<span><strong>${escapeHTML(formData.get("bathrooms"))}</strong> bathrooms</span>` : ""}${formData.get("size") ? `<span><strong>${escapeHTML(formData.get("size"))} m²</strong> property size</span>` : ""}</div><p class="property-price">${money(Number(formData.get("price")), formData.get("currency"))}${purpose === "Rent" ? " / month" : purpose === "Short Stay" ? " / night" : ""}</p><p>${escapeHTML(description)}</p>${formData.get("features") ? `<section class="preview-features"><h3>Additional features</h3><p>${escapeHTML(formData.get("features"))}</p></section>` : ""}<section class="preview-contact"><h3>Contact owner/agent</h3><p>${escapeHTML(contactName)}</p><a class="button button--outline" href="tel:${contactPhone}">Call ${escapeHTML(contactName)}</a><p class="muted">This call link appears on the local property page in this browser only.</p></section></div></article><div class="form-actions"><button class="button button--outline" type="button" data-action="back-to-listing-form">Edit listing</button><button class="button button--primary" type="button" data-action="submit-listing">Publish listing</button><p id="publish-unavailable-note" class="form-notice" role="status">With the database disconnected, publishing saves this listing to this browser only. It will not be online or visible to other visitors.</p><p>This is a local preview only. Use “Save draft on this device” on the form to keep text fields in this browser.</p></div><div class="form-errors" id="submission-errors" role="alert" hidden></div>`;
    preview.hidden = false;
    preview.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleAccountForm(form) {
    const errors = [];
    const email = form.elements.email.value.trim();
    if (!email || !form.elements.email.validity.valid) errors.push("Enter a valid email address.");
    if (form.elements.password.value.length < 8) errors.push("Enter a password with at least 8 characters.");
    if (form.dataset.kind === "register") {
      if (!form.elements.name.value.trim()) errors.push("Enter your name.");
      if (!form.elements.terms.checked) errors.push("Please agree to the Terms & Conditions.");
    }
    const errorBox = form.querySelector(".form-errors");
    if (errors.length) {
      showErrors(errorBox, errors);
      form.querySelector(":invalid")?.focus();
      return;
    }
    if (!backend?.configured) {
      showErrors(errorBox, [backend?.error || "Supabase is not configured. Authentication is unavailable."]);
      return;
    }
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = form.dataset.kind === "register" ? "Creating account…" : "Signing in…";
    try {
      if (form.dataset.kind === "register") {
        const result = await backend.signUp({
          email,
          password: form.elements.password.value,
          name: form.elements.name.value.trim(),
          role: form.elements.role.value
        });
        form.elements.password.value = "";
        if (result.session) {
          const next = routeInfo().params.get("next");
          location.hash = ["post", "favorites"].includes(next) ? `/${next}` : "/dashboard";
        } else {
          showFormSuccess(errorBox, "Account created. Check your email for a confirmation link, then log in.");
        }
      } else {
        await backend.signIn({ email, password: form.elements.password.value });
        form.elements.password.value = "";
        const next = routeInfo().params.get("next");
        location.hash = ["post", "favorites"].includes(next) ? `/${next}` : "/dashboard";
      }
    } catch (error) {
      form.elements.password.value = "";
      showErrors(errorBox, [error.message || "Authentication failed. Please try again."]);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = form.dataset.kind === "register" ? "Create account" : "Continue";
    }
  }

  async function submitListing(button) {
    const form = document.querySelector("#listing-form");
    const errorBox = document.querySelector("#submission-errors");
    if (!backend?.configured) {
      const formData = new FormData(form);
      const contactName = formData.get("contactName").trim();
      const contactPhone = normalizeContactPhone(formData.get("contactPhone"));
      const images = appState.imagePreviewUrls.length
        ? [...appState.imagePreviewUrls]
        : [localListingPhotoPlaceholder];
      const now = new Date().toISOString();
      const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const purpose = formData.get("purpose");
      const listing = {
        id,
        title: formData.get("title").trim(),
        description: formData.get("description").trim(),
        category: formData.get("category"),
        purpose,
        price: Number(formData.get("price")),
        currency: formData.get("currency"),
        bedrooms: formData.get("bedrooms") ? Number(formData.get("bedrooms")) : null,
        bathrooms: formData.get("bathrooms") ? Number(formData.get("bathrooms")) : null,
        size: formData.get("size") ? Number(formData.get("size")) : null,
        region: formData.get("region"),
        city: formData.get("city").trim(),
        neighborhood: formData.get("neighborhood").trim(),
        address: [formData.get("addressDescription"), formData.get("neighborhood"), formData.get("city"), formData.get("region"), "Ghana"].filter(Boolean).join(", "),
        amenities: String(formData.get("features") || "").split(/[,\n]/).map((feature) => feature.trim()).filter(Boolean),
        images,
        image: images[0],
        imagePlaceholder: images[0] === localListingPhotoPlaceholder,
        advertiser: contactName,
        advertiserType: "Property advertiser",
        contactName,
        contactPhone,
        verifiedLabel: "Not verified",
        added: now.slice(0, 10),
        updatedAt: now.slice(0, 10),
        period: purpose === "Rent" ? "month" : purpose === "Short Stay" ? "night" : "",
        featured: false,
        status: "published",
        localOnly: true
      };

      button.disabled = true;
      button.textContent = "Publishing on this browser…";
      try {
        persistLocalListings([listing, ...appState.listings]);
        appState.listings.unshift(listing);
        showToast("Listing published on this browser only.", "success");
        location.hash = `/property/${encodeURIComponent(id)}`;
      } catch (error) {
        showErrors(errorBox, [`The listing could not be saved in this browser: ${error.message}`]);
        button.disabled = false;
        button.textContent = "Publish listing";
      }
      return;
    }
    if (!backend?.configured || !appState.user) {
      showErrors(errorBox, ["Sign in before submitting a property."]);
      return;
    }
    const formData = new FormData(form);
    button.disabled = true;
    button.textContent = "Uploading and submitting…";
    try {
      const listing = await backend.createListing({
        title: formData.get("title").trim(),
        category: formData.get("category"),
        purpose: formData.get("purpose"),
        description: formData.get("description").trim(),
        price: formData.get("price"),
        currency: formData.get("currency"),
        bedrooms: formData.get("bedrooms"),
        bathrooms: formData.get("bathrooms"),
        size: formData.get("size"),
        region: formData.get("region"),
        city: formData.get("city").trim(),
        neighborhood: formData.get("neighborhood").trim(),
      }, [...formData.getAll("images")].filter((file) => file.size > 0));
      appState.listings.unshift(listing);
      localStorage.removeItem(ownerDraftStorageKey());
      showToast("Your property was submitted for review.", "success");
      location.hash = "/my-properties";
    } catch (error) {
      showErrors(errorBox, [error.message || "The property could not be submitted."]);
      button.disabled = false;
      button.textContent = "Submit for review";
    }
  }

  async function handleEditSubmit(form) {
    const errors = [];
    if (!form.elements.title.value.trim()) errors.push("Enter a property title.");
    if (!form.elements.price.validity.valid) errors.push("Enter a valid price.");
    if (form.elements.description.value.trim().length < 30) errors.push("Description must be at least 30 characters.");
    const errorBox = form.querySelector(".form-errors");
    if (errors.length) {
      showErrors(errorBox, errors);
      return;
    }

    if (!backend?.configured) {
      showErrors(errorBox, ["Supabase is not configured. Changes cannot be saved."]);
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      await backend.updateListing(form.dataset.id, {
        title: form.elements.title.value.trim(),
        price: form.elements.price.value,
        description: form.elements.description.value.trim(),
        category: form.elements.category.value,
        purpose: form.elements.purpose.value,
        currency: form.elements.currency.value,
        region: form.elements.region.value.trim(),
        city: form.elements.city.value.trim(),
        neighborhood: form.elements.neighborhood.value.trim(),
        bedrooms: form.elements.bedrooms.value,
        bathrooms: form.elements.bathrooms.value,
        size: form.elements.size.value
      });
      showToast("Your changes have been saved.", "success");
      location.hash = "/my-properties";
    } catch (error) {
      showErrors(errorBox, [error.message || "Your changes could not be saved."]);
      button.disabled = false;
      button.textContent = "Save changes";
    }
  }

  async function handleProfileSubmit(form) {
    const fullName = form.elements.fullName.value.trim();
    const errorBox = form.querySelector(".form-errors");
    const phoneInput = form.elements.phone.value.trim();
    const whatsappInput = form.elements.whatsappPhone.value.trim();
    const contactEmail = form.elements.contactEmail.value.trim();
    const phone = normalizeContactPhone(phoneInput);
    const whatsappPhone = normalizeContactPhone(whatsappInput);
    const errors = [];
    if (!fullName) errors.push("Enter the contact person's name.");
    if (phoneInput && !phone) errors.push("Enter a valid phone number. Use a Ghana number such as 024 123 4567 or an international number beginning with +.");
    if (whatsappInput && !whatsappPhone) errors.push("Enter a valid WhatsApp number.");
    if (contactEmail && !validContactEmail(contactEmail)) errors.push("Enter a valid contact email address.");
    if (form.elements.publishContactPhone.checked && !phone) errors.push("Enter a valid phone number before choosing to share it.");
    if (form.elements.publishContactWhatsapp.checked && !whatsappPhone) errors.push("Enter a valid WhatsApp number before choosing to share it.");
    if (form.elements.publishContactEmail.checked && !validContactEmail(contactEmail)) errors.push("Enter a valid contact email before choosing to share it.");
    if (form.elements.publishContactName.checked && !fullName) errors.push("Enter a contact person's name before choosing to share it.");
    if (errors.length) {
      showErrors(errorBox, errors);
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      await backend.updateProfile({
        fullName,
        phone,
        whatsappPhone,
        contactEmail,
        publishContactName: form.elements.publishContactName.checked,
        publishContactPhone: form.elements.publishContactPhone.checked,
        publishContactWhatsapp: form.elements.publishContactWhatsapp.checked,
        publishContactEmail: form.elements.publishContactEmail.checked
      });
      appState.profile = {
        ...appState.profile,
        full_name: fullName,
        phone,
        whatsapp_phone: whatsappPhone,
        public_contact_email: contactEmail,
        publish_contact_name: form.elements.publishContactName.checked,
        publish_contact_phone: form.elements.publishContactPhone.checked,
        publish_contact_whatsapp: form.elements.publishContactWhatsapp.checked,
        publish_contact_email: form.elements.publishContactEmail.checked
      };
      appState.listingContacts.clear();
      if (appState.user) {
        appState.user.user_metadata = { ...appState.user.user_metadata, full_name: fullName };
      }
      showToast("Your profile has been updated.", "success");
      render();
    } catch (error) {
      showErrors(errorBox, [error.message || "Your profile could not be updated."]);
      button.disabled = false;
      button.textContent = "Save profile";
    }
  }

  async function toggleFavorite(button) {
    const id = button.dataset.id;
    const wasFavorite = appState.favorites.has(id);
    const isFavorite = !wasFavorite;
    if (isFavorite) appState.favorites.add(id);
    else appState.favorites.delete(id);
    button.classList.toggle("is-favorite", isFavorite);
    button.setAttribute("aria-pressed", String(isFavorite));
    const listing = currentListings().find((item) => item.id === id);
    button.setAttribute("aria-label", isFavorite
      ? `Remove ${listing?.title || "property"} from favorites`
      : `Save ${listing?.title || "property"} to favorites`);
    button.querySelector("span").textContent = isFavorite ? "♥" : "♡";

    if (appState.user && backend?.configured) {
      button.disabled = true;
      try {
        if (isFavorite) await backend.addFavorite(id);
        else await backend.removeFavorite(id);
      } catch (error) {
        if (wasFavorite) appState.favorites.add(id);
        else appState.favorites.delete(id);
        button.classList.toggle("is-favorite", wasFavorite);
        button.setAttribute("aria-pressed", String(wasFavorite));
        button.setAttribute("aria-label", `${wasFavorite ? "Remove from" : "Add to"} favorites`);
        button.querySelector("span").textContent = wasFavorite ? "♥" : "♡";
        showToast(`Favorite could not be updated: ${error.message}`);
      } finally {
        button.disabled = false;
      }
    } else if (!appState.user && isFavorite && backend?.configured && window.confirm("Sign in to sync saved properties across devices? Choose Cancel to keep this save temporarily on this device.")) {
      if (isFavorite) appState.pendingFavoriteIds.add(id);
      else appState.pendingFavoriteIds.delete(id);
      location.hash = "/login?next=favorites";
    } else if (!appState.user) {
      if (isFavorite) appState.pendingFavoriteIds.add(id);
      else appState.pendingFavoriteIds.delete(id);
      showToast(isFavorite ? "Saved for this visit. Sign in to keep favorites on your account." : "Removed from saved properties.");
    }
    if (routeInfo().path === "favorites") render();
  }

  async function deleteProperty(button) {
    if (!window.confirm("Delete this property listing? Its related image and favorites records will also be removed by the database.")) return;
    button.disabled = true;
    button.textContent = "Deleting…";
    try {
      await backend.deleteListing(button.dataset.id);
      showToast("Your property listing was deleted.", "success");
      location.hash = "/my-properties";
    } catch (error) {
      button.disabled = false;
      button.textContent = "Delete listing";
      showToast(`Property could not be deleted: ${error.message}`);
    }
  }

  async function loadAccountFavorites(user) {
    if (appState.favoritesLoadingUserId === user.id) return;
    appState.favoritesLoadingUserId = user.id;
    try {
      const rows = await backend.getFavorites();
      if (appState.user?.id !== user.id) return;
      const favoriteIds = new Set(rows.map((row) => row.property_id));
      for (const propertyId of appState.pendingFavoriteIds) {
        if (favoriteIds.has(propertyId)) {
          appState.pendingFavoriteIds.delete(propertyId);
          continue;
        }
        try {
          await backend.addFavorite(propertyId);
          favoriteIds.add(propertyId);
          appState.pendingFavoriteIds.delete(propertyId);
        } catch (error) {
          showToast(`Could not save a pending favorite: ${error.message}`);
        }
      }
      appState.favorites = favoriteIds;
      appState.favoritesUserId = user.id;
      render();
    } catch (error) {
      appState.favorites.clear();
      appState.favoritesUserId = user.id;
      showToast(`Your saved properties could not be loaded: ${error.message}`);
    } finally {
      if (appState.favoritesLoadingUserId === user.id) appState.favoritesLoadingUserId = null;
    }
  }

  async function handleContactForm(form) {
    const errors = [];
    if (!form.elements.name.value.trim()) errors.push("Enter your name.");
    if (!form.elements.email.value.trim() || !form.elements.email.validity.valid) errors.push("Enter a valid email address.");
    if (!form.elements.topic.value) errors.push("Choose a topic.");
    if (form.elements.message.value.trim().length < 10) errors.push("Write a message of at least 10 characters.");
    const errorBox = form.querySelector(".form-errors");
    if (errors.length) {
      showErrors(errorBox, errors);
      form.querySelector(":invalid")?.focus();
      return;
    }
    if (form.elements._gotcha.value) {
      showErrors(errorBox, ["The form could not be submitted. Please try again."]);
      return;
    }
    errorBox.hidden = true;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Sending…";
    try {
      const response = await fetch(contactFormEndpoint, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" }
      });
      if (!response.ok) {
        let message = "The message could not be sent. Please try again later.";
        try {
          const result = await response.json();
          if (Array.isArray(result.errors) && result.errors.length) {
            message = result.errors.map((item) => item.message).join(" ");
          }
        } catch (error) {
          console.warn("Formspree returned a non-JSON error response.", error);
        }
        throw new Error(message);
      }
      form.innerHTML = `<div class="form-message form-message--success" role="status"><strong>Thank you for your message.</strong><p>The EstateLink team has received your enquiry through Formspree.</p></div><a class="button button--outline" href="${href("home")}">Return to EstateLink</a>`;
    } catch (error) {
      showErrors(errorBox, [error.message || "The message could not be sent. Check your connection and try again."]);
      submitButton.disabled = false;
      submitButton.textContent = "Send message";
    }
  }

  document.addEventListener("click", (event) => {
    const homeLink = event.target.closest("#site-header .brand");
    if (homeLink && appState.mobileMenuOpen) {
      appState.mobileMenuOpen = false;
      renderHeader(routeInfo().path.split("/")[0]);
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const kind = action.dataset.action;
    if (kind === "menu") {
      appState.mobileMenuOpen = !appState.mobileMenuOpen;
      renderHeader(routeInfo().path.split("/")[0]);
    } else if (kind === "install-app") {
      installApp();
    } else if (kind === "purpose") {
      const currentForm = document.querySelector("#home-search .search-form");
      const retainedValues = currentForm
        ? Object.fromEntries(new FormData(currentForm).entries())
        : {};
      document.querySelectorAll("[data-action='purpose']").forEach((tab) => {
        const active = tab === action;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-pressed", String(active));
      });
      document.querySelector("#home-search").innerHTML = searchForm(action.dataset.purpose);
      const nextForm = document.querySelector("#home-search .search-form");
      for (const name of ["location", "category", "minPrice", "maxPrice"]) {
        if (retainedValues[name] != null) nextForm.elements[name].value = retainedValues[name];
      }
    } else if (kind === "clear-recent-history") {
      appState.recentlyViewed = [];
      try {
        localStorage.removeItem(recentlyViewedKey);
        render();
      } catch (error) {
        console.warn("Recently viewed properties could not be cleared from this browser.", error);
        showToast("History cleared for this visit, but browser storage could not be updated.");
        render();
      }
    } else if (kind === "favorite") {
      toggleFavorite(action);
    } else if (kind === "share") {
      const listing = currentListings().find((item) => item.id === action.dataset.id);
      if (listing) shareListing(listing);
    } else if (kind === "clear-filters") {
      document.querySelectorAll("[data-filter]").forEach((filter) => {
        if (filter.type === "checkbox") filter.checked = false;
        else if (filter.tagName === "SELECT") filter.selectedIndex = 0;
        else filter.value = "";
        filter.dispatchEvent(new Event("input", { bubbles: true }));
        filter.dispatchEvent(new Event("change", { bubbles: true }));
      });
    } else if (kind === "load-more") {
      appState.loadMore?.();
    } else if (kind === "submit-listing") {
      submitListing(action);
    } else if (kind === "delete-property") {
      deleteProperty(action);
    } else if (kind === "clear-owner-filters") {
      appState.listingFilters = { status: "all", search: "" };
      render();
    } else if (kind === "save-local-draft") {
      const form = document.querySelector("#listing-form");
      if (form) saveLocalListingDraft(form);
    } else if (kind === "delete-local-draft") {
      localStorage.removeItem(ownerDraftStorageKey());
      showToast("Local draft deleted from this device.", "success");
      render();
    } else if (kind === "back-to-listing-form") {
      const preview = document.querySelector("#listing-preview");
      if (preview) {
        preview.hidden = true;
        document.querySelector("#listing-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else if (["remove-photo", "move-photo", "feature-photo"].includes(kind)) {
      const index = Number(action.dataset.index);
      const files = appState.selectedListingImages;
      if (!Number.isInteger(index) || index < 0 || index >= files.length) return;
      if (kind === "remove-photo") files.splice(index, 1);
      else {
        const target = kind === "feature-photo" ? 0 : index + Number(action.dataset.direction);
        if (target < 0 || target >= files.length) return;
        const [file] = files.splice(index, 1);
        files.splice(target, 0, file);
      }
      const input = document.querySelector("#property-images");
      if (input) syncSelectedImages(input);
    } else if (kind === "preview-owner-listing") {
      const listing = appState.listings.find((item) => item.id === action.dataset.id);
      if (!listing) return;
      const dialog = document.createElement("dialog");
      dialog.className = "owner-preview-dialog";
      dialog.setAttribute("aria-labelledby", "owner-preview-title");
      dialog.innerHTML = `<form method="dialog"><button class="report-dialog__close" aria-label="Close preview">×</button><p class="eyebrow">OWNER PREVIEW · NOT PUBLIC</p>${imageMarkup(listing.image, listing.imagePlaceholder ? "No property photo provided" : listing.title)}<p>${statusBadge(normalizedStatus(listing))}</p><h2 id="owner-preview-title">${escapeHTML(listing.title)}</h2><p class="muted">${escapeHTML(locationText(listing))}</p><p class="property-price">${money(listing.price, listing.currency)}${listing.period ? ` / ${escapeHTML(listing.period)}` : ""}</p><p>${escapeHTML(listing.description || "")}</p><button class="button button--outline" value="close">Close preview</button></form>`;
      document.body.append(dialog);
      dialog.addEventListener("close", () => dialog.remove());
      dialog.showModal();
    } else if (kind === "sign-out") {
      if (!backend?.configured) return;
      action.disabled = true;
      backend.signOut()
        .then(() => {
          appState.user = null;
          appState.authReady = true;
          appState.favorites.clear();
          appState.pendingFavoriteIds.clear();
          appState.favoritesUserId = null;
          location.hash = "/home";
          render();
        })
        .catch((error) => {
          action.disabled = false;
          showToast(`Could not sign out: ${error.message}`);
        });
    } else if (kind === "report") {
      openReportDialog(action.dataset.subjectType || "listing", action.dataset.id || "", action.dataset.name || "EstateLink listing");
    } else if (kind === "gallery") {
      const dialog = document.createElement("dialog");
      dialog.className = "gallery-dialog";
      dialog.innerHTML = `${imageMarkup(action.dataset.src, "Selected property photo")}<button type="button" class="gallery-dialog__close" aria-label="Close photo">×</button>`;
      document.body.append(dialog);
      dialog.showModal();
      dialog.querySelector("button").addEventListener("click", () => dialog.close());
      dialog.addEventListener("close", () => dialog.remove());
      dialog.addEventListener("click", (dialogEvent) => { if (dialogEvent.target === dialog) dialog.close(); });
    }
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!form.matches("[data-form], #listing-form")) return;
    event.preventDefault();
    if (form.id === "listing-form") handleListingSubmit(form);
    else if (form.dataset.form === "account") handleAccountForm(form);
    else if (form.dataset.form === "contact") handleContactForm(form);
    else if (form.dataset.form === "edit-listing") handleEditSubmit(form);
    else if (form.dataset.form === "profile") handleProfileSubmit(form);
    else if (form.dataset.form === "browse-search") {
      const query = new URLSearchParams();
      document.querySelectorAll("[data-filter]").forEach((filter) => {
        if (filter.type === "checkbox" ? filter.checked : filter.value) {
          const value = filter.type === "checkbox" ? filter.value : filter.value.trim();
          if (filter.type === "checkbox" && filter.dataset.filter === "amenity") query.append(filter.dataset.filter, value);
          else query.set(filter.dataset.filter, value);
        }
      });
      location.hash = `/browse?${query.toString()}`;
    }
    else if (form.dataset.form === "search") {
      const formData = new FormData(form);
      const minimum = formData.get("minPrice");
      const maximum = formData.get("maxPrice");
      const error = form.querySelector("[data-search-error]");
      if (minimum !== "" && maximum !== "" && Number(maximum) < Number(minimum)) {
        error.textContent = "Maximum budget must be greater than or equal to the minimum budget.";
        error.hidden = false;
        form.elements.maxPrice.focus();
        return;
      }
      error.hidden = true;
      const query = new URLSearchParams();
      for (const [key, value] of formData.entries()) if (value) query.set(key, value);
      location.hash = `/browse?${query.toString()}`;
    }
  });

  document.addEventListener("input", (event) => {
    const form = event.target.closest?.("[data-form='search']");
    if (form) form.querySelector("[data-search-error]").hidden = true;
  });

  document.addEventListener("reset", (event) => {
    const form = event.target;
    if (form.matches?.("[data-form='search']")) {
      window.setTimeout(() => {
        const error = form.querySelector("[data-search-error]");
        if (error) error.hidden = true;
      });
    }
  });

  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || image.dataset.fallbackApplied) return;
    image.dataset.fallbackApplied = "true";
    image.src = localListingPhotoPlaceholder;
    image.alt = "Property photo unavailable";
  }, true);

  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-profile-photo]")) {
      const file = event.target.files[0];
      if (!file) return;
      if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type) || file.size > 5 * 1024 * 1024) {
        showToast("Choose a JPEG, PNG, WebP, or AVIF profile image under 5 MB.");
        event.target.value = "";
        return;
      }
      if (appState.profilePhotoUrl) URL.revokeObjectURL(appState.profilePhotoUrl);
      appState.profilePhotoUrl = URL.createObjectURL(file);
      const preview = document.querySelector("[data-profile-photo-preview]");
      if (preview) preview.innerHTML = `<img src="${appState.profilePhotoUrl}" alt="Local profile photo preview">`;
      return;
    }
    if (event.target.id !== "property-images") return;
    const files = [...event.target.files];
    const preview = document.querySelector("#image-previews");
    if (!preview) return;
    const errors = [];
    if (files.length > 8) errors.push("Choose no more than 8 photos.");
    if (files.some((file) => !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type))) errors.push("Choose JPEG, PNG, WebP, or AVIF images only.");
    if (files.some((file) => file.size > 10 * 1024 * 1024)) errors.push("Each photo must be 10 MB or smaller.");
    if (errors.length) {
      showErrors(document.querySelector("#listing-errors"), errors);
      event.target.value = "";
      appState.selectedListingImages = [];
      renderImagePreviews(event.target);
      return;
    }
    appState.selectedListingImages = files;
    renderImagePreviews(event.target);
  });

  document.addEventListener("dragover", (event) => {
    if (event.target.closest("[data-drop-zone]")) event.preventDefault();
  });

  document.addEventListener("drop", (event) => {
    const dropZone = event.target.closest("[data-drop-zone]");
    if (!dropZone) return;
    event.preventDefault();
    const input = dropZone.querySelector("#property-images");
    const files = [...(event.dataTransfer?.files || [])];
    if (!input || !files.length) return;
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  document.addEventListener("input", (event) => {
    const field = event.target;
    if (!field.name || !["title", "description"].includes(field.name)) return;
    const counter = document.querySelector(`[data-counter-for="${field.name}"]`);
    if (counter) counter.textContent = `${field.value.length} / ${field.maxLength}`;
  });

  window.addEventListener("hashchange", render);

  async function installApp() {
    const browser = navigator.userAgent;
    const instructions = /iPhone|iPad|iPod/.test(browser) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
      ? "In Safari, tap Share, then choose “Add to Home Screen”."
      : /Android/i.test(browser)
        ? "Open your browser menu and choose “Install app” or “Add to Home screen”."
        : "Open your browser menu and choose “Install EstateLink” or “Install this site as an app”.";
    showToast(instructions);
  }

  window.addEventListener("appinstalled", () => {
    appState.appInstalled = true;
    renderHeader(routeInfo().path.split("/")[0]);
    showToast("EstateLink GH has been installed.", "success");
  });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("/service-worker.js")
      .catch((error) => console.error("EstateLink offline support could not be enabled.", error));
  }

  async function initializeBackend() {
    render();
    if (!appState.liveMode) return;
    if (!backend?.configured) {
      appState.listingsState = "error";
      appState.listingsError = backend?.error || "The Supabase client is unavailable.";
      appState.authReady = true;
      render();
      return;
    }

    backend.onAuthStateChange((_event, session) => {
      appState.user = session?.user || null;
      appState.authReady = true;
      if (!appState.user) {
        appState.favorites.clear();
        appState.pendingFavoriteIds.clear();
        appState.favoritesUserId = null;
      } else if (appState.favoritesUserId !== appState.user.id) {
        loadAccountFavorites(appState.user);
      }
      window.setTimeout(render, 0);
    });

    try {
      const session = await backend.getSession();
      appState.user = session?.user || null;
      appState.authReady = true;
      if (appState.user) await loadAccountFavorites(appState.user);
      render();
    } catch (error) {
      appState.authReady = true;
      appState.authError = error.message;
      render();
    }

    try {
      appState.listings = await backend.getListings();
      appState.listingsState = "ready";
      appState.listingsError = "";
    } catch (error) {
      appState.listingsState = "error";
      appState.listingsError = error.message;
    }
    render();
  }

  initializeBackend();
})();
