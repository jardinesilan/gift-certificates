UNIDA GIFT CERTIFICATE STORE — fixed files (Oct 18, 2026)
=========================================================

WHAT THESE FIX
- Your GitHub repo has the app files, but Railway can't build them
  (it expects the files in folders that aren't there). These files are
  rewritten for the flat layout you already uploaded — just overwrite.
- BONUS (you asked for this today): every sale now also emails YOU a
  copy, so you always have the gift code and amount in your inbox.

READ THIS FIRST — do it in this order:
1. Find Toni's gift code from the LIVE site first (it's still running).
   A redeploy wipes the current database, and her purchase only
   exists there. Get the code, THEN do the steps below.

STEPS (on your PC):
1. Unzip this file. Inside you'll see the files plus a "public" folder.
2. Go to github.com/jardinesilan/gift-certificates in your browser,
   click "Add file" -> "Upload files".
3. Drag ALL the files AND the "public" folder into the upload box
   (drop them on the dashed upload area, not the page around it).
   Scroll down and click "Commit changes".
4. Railway starts a new deploy on its own. Open the Deployments tab
   and wait until it says Success.
5. ONE-TIME SETUP: in Railway, open your gift-certificates service ->
   the Variables tab -> add a new variable:
       OWNER_EMAIL = jardinesilan@gmail.com
   This is what sends you a copy of every sale. Redeploy once after
   adding it (Deployments -> Redeploy).

That's it — the store comes back live with the fix, and you'll get
an email for every future purchase.
