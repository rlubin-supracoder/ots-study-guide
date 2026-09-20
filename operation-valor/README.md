# Operation Valor

Russell Lubinski, 27-01

Operation Valor is a shared location check-in tool for the OTS land navigation exercise. Each participant gets a number when they join. When someone sends a check-in, their latest position appears as a numbered marker on a map that the whole joined team and the exercise admin can see. This is a check-in system, not continuous tracking.

## Where to go

- **Participant check-in:** [valor.russelllubinski.us](https://valor.russelllubinski.us/). You can also enter `Valor` in OTS Trainer to open the same page.
- **Shared team map:** [valor.russelllubinski.us/map](https://valor.russelllubinski.us/map). Join the exercise first, then open the map.
- **Exercise control:** [valor.russelllubinski.us/control](https://valor.russelllubinski.us/control). This is for the admin and requires Cloudflare Access sign-in.
- **Location and privacy details:** [valor.russelllubinski.us/privacy.html](https://valor.russelllubinski.us/privacy.html).

## The exercise from start to finish

1. The admin opens **Exercise control** and selects **Start exercise**. Until then, participants see a standby message and cannot join.
2. Participants open the check-in page, enter their assigned code names, and select **Join exercise**. Joining puts them on the roster and gives each person a number. It does **not** ask for or send a location.
3. When a participant is ready, they select **Send my location** and allow the browser to use their location. The page looks for a fresh position, then sends one check-in. They can do this again later to replace their previous position.
4. Joined participants can open the shared map. The admin sees the same positions on the control page, along with the roster and exercise controls. Both maps update as check-ins arrive.
5. The admin selects **End exercise** to stop new joins and check-ins. The existing roster and map stay available until the admin clears them or the 24-hour limit is reached.
6. The admin selects **Clear data** after ending the exercise. That removes the roster and positions and resets numbering for the next exercise. The app also clears the data automatically 24 hours after **Start exercise**, even if the exercise ended earlier.

*I would like to finish this exercise, graduate, and go home. Ideally in that order, and preferably today.*

## Joining and getting a number

Use the code name assigned for the exercise. Names can be 1–24 characters and use letters, numbers, spaces, hyphens, or underscores. Two people cannot use the same code name in one exercise, even if they change the capitalization. The roster holds up to 100 participants at one time.

Your number stays the same while you remain in the exercise and use the same browser session. The site saves a private cookie in that browser so it can recognize you when you return. If you switch browsers or devices, it may treat you as a new participant. If you are already on the roster and try to join from another browser with the same code name, it will tell you that the name is taken.

The admin can remove one participant. Their name and latest position disappear from the roster and map, and their map access closes. They may join again, but they get a **new** number. Removing someone does not change anyone else's number, and the old number is not reused during that exercise. Clearing the whole exercise resets the numbering to 1.

## Sending a location

Pressing **Send my location** asks the phone or browser for a new position. The page may wait up to 30 seconds while it looks for a better reading, so keep it open. It ignores old or invalid readings. If you hide the page while it is still finding a position, the search stops and you can tap again when you return.

The target is **5 meters of reported accuracy**. If the phone reports 5 meters or better, the page sends the check-in automatically. If it cannot reach that target, the page shows its best reading and gives you two choices: **Try for a better position** or **Send approximate position**. Nothing is sent until you explicitly choose the approximate option. Five meters is the phone's estimate, not a promise that the marker is within five meters of your actual spot. Trees, buildings, phone settings, and the weather can all have opinions about GPS.

After the server receives a check-in, the page shows a receipt with the capture time, receipt time, and reported accuracy. If the connection breaks before the page gets that receipt, **Retry delivery** sends the same check-in again. The server recognizes that retry so it does not count it twice. If there is no fresh position at all, the page asks you to try again. An ended exercise, a removed participant, or a check-in from an older exercise cannot add a new position.

Only the **latest** successful check-in for each person is kept. Sending another one moves that person's marker; it does not draw a trail. The app also keeps each person's check-in count for the current exercise. There is a brief wait between accepted check-ins so someone cannot send them back to back instantly.

*If my marker is accurate enough to find the finish line, I would also appreciate directions to graduation and then home.*

## Reading the map and roster

The map and roster show everyone who has joined, including people who have not checked in yet. A person gets a map marker only after a successful check-in. You can search the roster by code name or number, select a person to focus on their marker, or use **Show all** to fit all current markers on the map.

Each marker has a number. Selecting it shows the code name, coordinates, reported accuracy, and the time the phone captured the position. The circle around the marker shows the phone's **estimated** accuracy. It is a helpful visual guide, not a guaranteed boundary.

- **Within target:** The latest reading reported 5 meters or better.
- **Approximate:** The person chose to send a reading over 5 meters.
- **Stale:** The latest reading is more than 5 minutes old. The marker stays on the map, but it should not be treated as a live position.
- **Awaiting first check-in:** The person joined but has not sent a position.

The summary counts show participants, people who have checked in, check-ins within the 5-meter target, and people still waiting or stale. Map and roster changes are pushed to open pages. If that live connection drops, the page tries to reconnect and checks for updates again. A stale marker does not mean the person is missing; it only means they have not sent a recent check-in.

## What the admin can do

The control page has the shared map plus three exercise buttons and a **Remove** button beside each participant. Each action asks for confirmation.

- **Start exercise** opens joining and check-ins and starts the 24-hour data clock.
- **End exercise** stops joining and new check-ins. The current map and roster remain visible.
- **Clear data** is available after the exercise ends. It removes all participant names and positions from the app and prepares a fresh exercise.
- **Remove** deletes one participant's entry and latest position. That participant can join again with a new number while the exercise is active.

The admin must sign in through Cloudflare Access. The app checks the signed Access token for control pages and actions; simply knowing the control address does not grant control. The shared map is available to joined participants, but exercise controls are reserved for the admin.

*The admin can end the exercise. I am still waiting for the button that ends OTS and sends me home.*

## Location and privacy

Joining alone does not request location. The page asks for it only when a participant taps the check-in button. A successful check-in stores the code name, number, coordinates, reported accuracy, capture time, server receipt time, and current check-in count. Joined participants and the admin can see everyone's latest position. Anyone who has the app address can join while an exercise is open, so use exercise code names rather than personal information. The shared map requires a joined browser session.

The app stores exercise data on Cloudflare. It does not keep a route history, put a location in the participant cookie, or use advertising or analytics scripts. The cookie identifies the browser for up to 24 hours. App-level data clears when the admin clears it or 24 hours after exercise start. Cloudflare infrastructure backups may retain recoverable storage for a limited period after that clearing.

The maps load background map tiles from OpenStreetMap. OpenStreetMap receives normal requests for those tiles, including the map area being viewed and the viewer's IP address. Operation Valor does not send it participant names or check-in records. See the [location and privacy page](https://valor.russelllubinski.us/privacy.html) for the same details in the app.

## How the app works behind the pages

The participant page, shared map, and admin page all talk to one Cloudflare Worker. Think of the Worker as the front desk: it serves the pages, checks who is allowed to do what, and passes exercise requests to one saved exercise record. That record holds the exercise status, roster, and each person's latest check-in. Using one record lets the app assign numbers and accept simultaneous check-ins without two people accidentally getting the same number.

The browser cookie identifies a participant, but the server stores a scrambled version of its value with the roster. The participant page can read only that browser's session; a joined browser can read the team map; the signed-in admin can read and change exercise control. The server also checks that write requests come from this site, checks location values and times, and rejects duplicate or outdated check-ins. The map receives updates over a live connection, with periodic checks if that connection is interrupted.

The main files are:

- `public/index.html` and `public/participant.js`: joining, requesting a position, and sending a check-in.
- `public/acquire.mjs`: finding the best fresh location reading.
- `public/map.html`, `public/control.html`, and `public/controller.js`: the team map, admin map, roster, and controls.
- `src/worker.mjs`: page and request routing, saved exercise state, and live updates.
- `src/model.mjs`: the rules for names, numbers, check-ins, exercise changes, and data clearing.
- `src/auth.mjs`: participant sessions and admin sign-in checks.
- `wrangler.jsonc`: the Cloudflare site address, saved exercise binding, and deployment settings.

## Running it locally

From the `operation-valor` folder, install dependencies and start the local preview:

```sh
pnpm install
pnpm dev
```

Open `http://127.0.0.1:8787/` for the participant page, `/map` for the shared map, and `/control` for exercise control. Local control access works only through `127.0.0.1`. The development command creates a separate local configuration inside the ignored `.wrangler/` folder; it does not use the production admin sign-in settings. Browser location access requires a secure context; the loopback address is allowed for local development.

Run the regular tests with:

```sh
pnpm test
```

For the full local exercise test, leave `pnpm dev` running in another terminal and run:

```sh
node test/integration.mjs
```

That test checks concurrent joins and check-ins, shared map access, removal, and exercise closure. It clears the local exercise as it runs, then leaves a small **Demo** exercise with made-up names and positions for visual review. Use it only against the local preview.

## Deploying

`wrangler.jsonc` holds the production site address and the Cloudflare Access team domain and audience. Before deploying, verify those values for the intended Cloudflare account and protect both `/control` and `/api/control/*` with the **same** Cloudflare Access application. The app also verifies Access tokens itself and rejects controller requests if sign-in is not configured.

From the `operation-valor` folder:

```sh
pnpm build
pnpm deploy
```

`pnpm build` prepares the local map files and checks the Worker build. `pnpm deploy` prepares those files and deploys the production Worker. Use the checked-in `wrangler.jsonc` for deployment, not the generated local file in `.wrangler/`.

## If something is not working

- **Still says Stand by:** The admin has not started the exercise, or the previous exercise was cleared and a new one has not started.
- **Code name is taken:** Return to the browser where you first joined, or ask the admin to remove the old entry so you can join again with a new number.
- **No location appears:** Allow precise location for the site, keep the page open while it searches, and try an open area. Joining by itself does not place a marker.
- **Accuracy stays above 5 meters:** Try again, or choose **Send approximate position** if that estimate is useful for the exercise.
- **Delivery is uncertain:** Check the receipt. If **Retry delivery** appears, use it; the same check-in will not be counted twice.
- **Map says Join to view:** Go back to the check-in page and join or rejoin the current exercise in that browser.
- **Live connection is interrupted:** The map will try to reconnect. Reload the page if it does not recover.
- **Admin sign-in fails:** Open `/control` through the protected address and check the Cloudflare Access setup for the control page and control requests.

*If all else fails, I will be in the field trying to locate a strong GPS signal, my diploma, and the road home.*
