# SKR CV Guide — setup

The website is static (GitHub Pages). Bookings go to a Google Apps Script attached to
your Google Sheet. The script saves each row, assigns the Booking ID (1000, 1011, 1022 …),
emails you the details and sends the student a "request received" email.

## 1. Google Sheet + script (about 5 minutes)

1. Open your Apps Script project (script.google.com). Delete the sample code and paste all of
   `apps-script/Code.gs`. Save.
   *(It also works from a Sheet via Extensions → Apps Script.)*
2. In the function dropdown pick **setup** and click **Run**. Approve the permissions
   (Sheets + send email as you).
   - In a standalone script, this **creates a Google Sheet "SKR CV Guide — Bookings"** in your Drive.
     Its link appears under **Execution log**. To use an existing sheet instead, put its ID in `SHEET_ID`.
   - The `Bookings` tab gets columns A–U.
3. Click **Deploy → New deployment → ⚙ → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy** and copy the **Web app URL** (ends in `/exec`).
4. Paste that URL into `assets/config.js` → `BOOKING_ENDPOINT: '…/exec'`.

Booking emails go to the Google account that owns the script. To use another inbox,
set `NOTIFY_EMAIL` at the top of `Code.gs` and **Deploy → Manage deployments → Edit → New version**.

> After any change to `Code.gs` you must publish a **new version** of the same deployment
> (Manage deployments → Edit → Version: New version). The URL stays the same.

## 2. Bank details

Fill in the `BANK` lines in `assets/config.js`. Each line gets its own **Copy** button.
Empty lines are hidden.

## 3. Daily workflow for your team

| Column | What to do |
|---|---|
| R Payment Status | `Pending` → `Paid` after checking the bank statement (`Submitted – verify` means the student entered a transaction ID, saved in U) |
| S Booking Status | `Requested` → `Confirmed` (or `Cancelled` / `Rejected`, which frees the slot on the website) |
| T Google Meet Link | paste the Meet link, then send the confirmation on WhatsApp |
| U Admin Notes | anything internal |

The website greys out times that are already requested (unless Booking Status contains
"cancel" or "reject"). Several students can request the **same batch start time**, since that is
a group session. Individual sessions block any overlapping time.

## 4. Changing prices or hours

- Prices and durations: `SERVICES` in **both** `assets/config.js` (display) and
  `apps-script/Code.gs` (what gets saved). The script never trusts the price sent by the browser.
- Booking hours: `WINDOWS` in both files (minutes from midnight, Bangladesh time).
- After editing site files, bump `?v=1` → `?v=2` in `index.html` so browsers fetch the new version.
