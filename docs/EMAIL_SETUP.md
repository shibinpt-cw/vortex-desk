# Sending email from Vortex Desk: the plan

Right now the email scene in the Files tab is only an animation: nothing is sent. This is how we make it real.
Pick ONE of the two routes. Route A takes about 10 minutes. Route B is the proper, shareable one and takes about an hour.

---

## Route A: Gmail with an App Password (fastest)

Best for: you alone, on your own Gmail account.

**What you do**
1. Open https://myaccount.google.com/security and turn on **2-Step Verification** (App Passwords need it).
2. Open https://myaccount.google.com/apppasswords, name it "Vortex Desk", press **Create**.
3. Google shows a 16-letter password once. Copy it.
4. In the Vortex Desk control app (a new **Accounts** page, I build it): paste your Gmail address and that 16-letter password, press **Save** and **Send a test to myself**.

**What I build**
- `app/src/email.js` in the main process using SMTP (`smtp.gmail.com`, port 465) with the `nodemailer` package.
- The password is stored encrypted with Electron's `safeStorage` (tied to your Windows login), never in a plain file and never shown again.
- The composer's **Send** button calls it, with the attachment from the Files tab.

**Limits**: 25 MB per email. Does not work if your Google account is a work or school account that blocks App Passwords.

---

## Route B: Gmail API with Google sign-in (OAuth), recommended long term

Best for: sharing Vortex Desk with other people later, or accounts that block App Passwords. No password is stored at all.

**What you do (once)**
1. Go to https://console.cloud.google.com and create a project called "Vortex Desk".
2. **APIs & Services → Library** → search "Gmail API" → **Enable**.
3. **APIs & Services → OAuth consent screen** → User type **External** → fill the app name (Vortex Desk), your email, save.
4. On the same screen add the scope `https://www.googleapis.com/auth/gmail.send` (send only; it cannot read your mail).
5. Under **Test users** add your own Gmail address. (While the app is in "Testing", Google asks you to sign in again every 7 days. Publishing the app, which needs Google's review, removes that.)
6. **Credentials → Create credentials → OAuth client ID** → Application type **Desktop app** → Create.
7. Send me the **Client ID** (the Client secret too if shown; for a desktop app it is not truly secret).

**What I build**
- A **Connect Gmail** button in the control app. It opens your browser to Google's sign-in page, you press Allow, and you land on a small "You can close this" page.
- Under the hood: the standard desktop flow (PKCE) with a one-time listener on `127.0.0.1`, then tokens are stored encrypted with `safeStorage`; the access token refreshes itself.
- Sending uses `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with a proper MIME message (text, attachments).

---

## What is the same for both routes

1. **Lumina always asks before sending.** She writes the draft, shows To, Subject and the attachment, and only sends after you press Send (or say "yes, send it"). She never sends on her own.
2. In the Files tab, "Send by email" uses the same composer; the drone animation plays when Google confirms the message was accepted, and shows an honest error if it was not.
3. You can say "email Maya the photo" to Lumina: she fills in the draft and waits for your OK.
4. A **Sent** list in the control app shows what went out and when.

## Order of work
1. You choose A or B (and, for B, do the Google Cloud steps and send me the Client ID).
2. I build the Accounts page and `email.js`.
3. We send a test email to yourself.
4. I connect the composer, the drone scene and Lumina's voice command.
