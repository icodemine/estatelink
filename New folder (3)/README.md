 b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b b44444444444444444444444444444                             bbbbbbbbbb                                               vbb
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
  # EstateLink

EstateLink is a responsive, vanilla HTML/CSS/JavaScript property frontend. It is currently running in frontend-only preview mode: Supabase Auth, Postgres, and Storage are not loaded or contacted.

## Run locally

From this folder, run:

```powershell
node .\server.js
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173). Node.js is required for the local server. An internet connection is only needed for external stock imagery and the optional contact form. To use a different port, set `PORT` before starting the server:

```powershell
$env:PORT = "8080"
node .\server.js
```

The server is for local development and binds to `127.0.0.1`; it is not a production web server.

## Mobile app icon and launch screen

The uploaded [`logo.png`](./logo.png) is the source of the EstateLink mark used in the site header/footer and generated app icons in `assets/icons/`. The [web app manifest](./manifest.webmanifest), Apple touch icon, and [service worker](./service-worker.js) provide install metadata and offline app-shell support. Deploy the files to the site over HTTPS before installing; `file://` previews are not installable. On Android, open the deployed site in Chrome and use the browser’s **Install app** / **Add to Home screen** option; on mobile, the site navigation includes a button with the browser-specific installation steps. On iPhone/iPad, open the HTTPS site in Safari, open the site navigation, then choose **Add to Home Screen** or use **Share → Add to Home Screen**. The launch screen is provided by the mobile operating system when the installed shortcut opens; ordinary browser visits continue to open the page directly. The service worker caches the app shell; live property data and account features are unavailable in frontend-only mode.

## Hosting and security headers

The root [`_headers`](./_headers) file configures Content-Security-Policy, MIME sniffing protection, referrer policy, frame protection, and a restrictive permissions policy for Netlify static hosting and deploy previews. The policy permits Unsplash property imagery and Formspree contact form submissions; it does not permit Supabase connections. Review it if those service hosts change.

Netlify is currently used for testing. These headers only take effect when a Netlify deployment serves this folder; they do not change the local development server or the live site until a deploy containing `_headers` is published. Configure equivalent headers at the eventual production host. HSTS is intentionally not set here because this Netlify subdomain is a testing host; configure HSTS at the production hostname after confirming HTTPS is enforced across that host.

## Frontend-only mode

The Supabase SDK, project configuration, and adapter are intentionally not loaded by [`index.html`](./index.html). The frontend makes no Supabase requests, so database schema differences cannot block the UI while it is being completed. No Supabase schema, policies, or live data were changed.

- Homepage and browse pages show a clear notice that live listings are unavailable; they do not display fabricated listings.
- The add-property page supports form validation, local photo previews (including a call link), listing preview, and drafts saved in the current browser. “Publish listing” saves a local listing that appears in Home and Browse in that browser and opens its property details page. It is not published online or visible to other visitors; contact details stay in browser storage, and photos are not saved.
- Sign-in, registration, profile, and account pages are temporarily unavailable. Do not enter passwords in this mode.
- The configured contact form remains a separate Formspree integration. Listing/profile reports remain frontend-only prototypes.

To reconnect later, first verify the live schema and RLS policies, resolve the missing profile contact columns, then deliberately restore the SDK/config/adapter script loading and corresponding Content-Security-Policy permissions. Never place a Supabase service-role or secret key in frontend code.

## Contact, safety, and discovery frontend

- The Contact EstateLink form posts to the Formspree endpoint supplied by the site operator (`https://formspree.io/f/xrbyoplr`). Confirm the endpoint is active and submissions reach the intended Formspree account before relying on it. This form is public and can receive spam; use Formspree's available anti-spam controls and monitor the destination inbox.
- Listing and profile report dialogs are frontend prototypes. They validate a reason and show a confirmation, but they do not transmit or persist reports. Connect a trusted reporting service before advertising this as a monitored safety-report channel.
- The owner messages and notifications pages do not have backend integrations and show empty, not-connected states; they do not contain example records.
- Homepage property-category shortcuts and decorative backgrounds use stock property photos from Unsplash. Listing cards show no properties while the database is disconnected.
- Property pages provide share options, a safety reminder, related published listings, advertiser contact links, and a trust-status display. Listings currently remain unverified unless a trusted source provides verification data; no verification is implied by the interface.
- Search includes location, region, city, purpose, type, price, bedrooms, bathrooms, size, verification status, and sorting. A verified-only search uses a positive verification value on a listing and therefore returns no results until such data is connected.
- Recently viewed IDs, local listing drafts, and guest favorites stay in the visitor's browser. Account-synced favorites are unavailable while the database is disconnected.

The SQL snippet supplied for the existing database includes a stray `New user` line inside the profile-trigger function. It would make that function invalid if the snippet were run as written. No SQL was executed or applied by this frontend change.

## Project structure

- `index.html` — shared document shell; only frontend assets are loaded
- `assets/css/styles.css` — responsive design system and page styles
- `assets/js/data.js` — property-category shortcuts for browsing
- `assets/js/supabase-config.js` and `assets/js/backend.js` — dormant Supabase configuration and adapter, not loaded in frontend-only mode
- `assets/js/app.js` — hash routes, UI rendering, validation, and interactions
- `supabase/schema.sql` — read-only query to inspect existing public table columns
- `supabase/property-contact-migration-proposal.sql` — un-applied proposal for opt-in listing contact data and a narrowly scoped published-listing RPC; requires schema/RLS review first
- `supabase/contact-setup-preflight.sql` — read-only inspection of live profile/property columns, RLS, policies, and foreign-key relationships before the contact migration
- `supabase/storage-policies-proposal.sql` — un-applied proposal for private property image access, owner uploads/deletes, and published-listing signed URL reads
- `server.js` — local development static-file server only; not for production hosting

Hash routes can be opened directly, for example `/#/browse` or `/#/property/<property-id>`.

## Legal pages

The `/#/terms` and `/#/privacy` routes contain working drafts linked from registration and the site footer. They are not legal advice or publication-ready policies. Before relying on them, confirm the operator’s legal identity and contact details, data retention and privacy-request process, governing-law provisions, and have qualified counsel review them. The registration checkbox is validated in the frontend and is not stored as a durable record of which terms version a user accepted.
