# HomePlan Capture (iPhone app)

A small iPhone app that scans a room or an object with the LiDAR camera and saves the result
as a folder you can send to a computer for HomePlan. It needs an iPhone or iPad with LiDAR
(iPhone 12 Pro or later Pro models; built for an iPhone 15 Pro) running iOS 17 or later.

- **Scan room** uses Apple RoomPlan. It saves walls, doors, windows, openings and object boxes
  (`room.json`), photos taken as you walk (`frames/`), and the LiDAR mesh with colours
  (`mesh.ply`).
- **Scan object** uses Apple Object Capture. It guides you round the object, then builds a
  textured 3D model on the phone (`object.usdz`).

The exact contents of a saved folder are described in `docs/scan/FORMAT.md`.

**Be aware: nobody has built this yet.** It was written on a computer without Xcode, so it has
never been compiled or run. Expect a round or two of fixing. If Xcode shows errors, copy the
first red error message (file name, line number and text) and pass it back. Lines marked
`// VERIFY:` in the code are the places where the author was least sure of Apple's API, and are
the likely places for an error.

## What you need

- A Mac with Xcode 15 or later (free from the Mac App Store).
- A free Apple ID. A paid developer account is not needed.
- The iPhone and its USB cable.
- This repository on the Mac (on GitHub, Code, Download ZIP, then unzip it; or `git clone`).

## Install on the iPhone

The default path is to open the project file that comes with the repository. It was written
by hand and has not been opened by anyone yet. If it will not open, use one of the two
fallbacks further down.

1. **Sign in to Xcode.** Open Xcode, then Xcode menu, Settings, Accounts. Press the plus
   button, choose Apple ID and sign in.
2. **Open the project.** In Finder, open the folder `ios/HomePlanCapture` and double click
   `HomePlanCapture.xcodeproj`.
3. **Set the team.** In the left column click the blue HomePlanCapture icon at the top. In the
   middle, under Targets, click HomePlanCapture, then the Signing & Capabilities tab. Tick
   "Automatically manage signing". Set Team to your name followed by "(Personal Team)".
4. **Change the bundle identifier.** In the same tab, change Bundle Identifier from
   `com.example.homeplancapture` to something only you would use, for example
   `com.yourname.homeplancapture`. Apple refuses identifiers someone else already has. The
   red error under Signing should go away after a few seconds.
5. **Connect the phone.** Plug the iPhone into the Mac and unlock it. If the phone asks
   whether to trust this computer, tap Trust.
6. **Turn on Developer Mode** (once). On the iPhone: Settings, Privacy & Security, Developer
   Mode, turn it on and let the phone restart. The option only appears after the phone has
   been connected to Xcode once, so do step 5 first.
7. **Run.** At the top of the Xcode window, click the device menu and choose your iPhone (not
   a simulator; the app cannot run in the simulator). Press the Run button (the triangle).
   The first build takes a minute or two.
8. **Trust yourself on the phone** (once). The first time, the phone says "Untrusted
   Developer". On the iPhone go to Settings, General, VPN & Device Management, tap your Apple
   ID under Developer App, and tap Trust. Then open HomePlan Capture from the home screen.
9. Allow camera access when the app asks.

### The 7 day limit

With a free Apple ID the app stops opening 7 days after you installed it. To renew it, connect
the phone, open the project in Xcode and press Run again. Installing over the old copy keeps
your saved scans, but send important scans to the computer before then anyway, and do not
delete the app from the phone, as that deletes its scans. A free account can have at most 3
such apps on a phone at once. A paid developer account ($99 a year) makes an install last a
year.

### Fallback 1: generate the project with XcodeGen

If `HomePlanCapture.xcodeproj` will not open or is damaged, rebuild it from `project.yml`:

1. Install Homebrew from https://brew.sh if you do not have it.
2. In Terminal: `brew install xcodegen`
3. In Terminal, go to the folder: `cd path/to/Sketchup/ios/HomePlanCapture`
4. Run `xcodegen generate`. This replaces `HomePlanCapture.xcodeproj`.
5. Continue from step 2 of the install steps.

### Fallback 2: make a new project in Xcode and add the code

1. In Xcode: File, New, Project. Choose iOS, App. Product Name `HomePlanCapture`, Team your
   Personal Team, Organization Identifier something like `com.yourname`, Interface SwiftUI,
   Language Swift, no tests, no Core Data. Save it anywhere.
2. In the left column, select and delete the files Xcode made for you, `ContentView.swift` and
   `HomePlanCaptureApp.swift` (Move to Trash).
3. Drag the `ios/HomePlanCapture/Sources` folder from Finder into the left column. In the
   dialog tick "Copy items if needed", choose "Create groups", and make sure the
   HomePlanCapture target is ticked.
4. Click the blue project icon, the HomePlanCapture target, then the General tab. Set Minimum
   Deployments to iOS 17.0. Under Supported Destinations keep only iPhone.
5. In the Info tab, under Custom iOS Target Properties, press the plus on any row to add:
   - Privacy, Camera Usage Description: `Scans rooms and objects.`
   - Application supports iTunes file sharing: YES
   - Supports opening documents in place: YES
   - Required device capabilities: add an item `arkit`
6. In Build Settings, search for "Optimization Level". Under Swift Compiler, set Debug to
   "Optimize for Speed". Without this the mesh colouring step at the end of a room scan is
   very slow.
7. Continue from step 4 of the install steps.

## Using the app

1. Type a name (for example `kitchen`). It becomes the folder name, for example
   `kitchen-room`. If that name is taken, the app adds `-2`, `-3` and so on.
2. Tap **Scan room** or **Scan object**.
3. When you finish, the app saves the folder and offers **Share zip**.
4. Every saved scan is listed on the home screen. Tap the share icon to send it again, or swipe
   left to delete it.

The switch "Colour mesh with room scans" is on by default. RoomPlan does not offer the LiDAR
mesh itself, so the app quietly turns on ARKit's mesh in RoomPlan's camera session. Apple does
not say whether RoomPlan is happy with that. If room scans start failing, stop early, or the
walls come out wrong, turn the switch off and scan again; you then get everything except
`mesh.ply`. Each folder has a `capture-log.txt` saying what happened.

## Getting a scan to the computer

Tap **Share zip** (or the share icon on the home screen). The phone makes one `.zip` of the
folder. Then choose one of:

- **AirDrop** to your Mac. It lands in Downloads.
- **Save to Files**, then iCloud Drive. It appears in iCloud Drive in Finder on the Mac.
- **Google Drive** (needs the Google Drive app on the phone). Then share the Drive file or
  download it on the computer.

The folders are also visible without zipping: open the Files app, Browse, On My iPhone,
HomePlan Capture. On a Mac you can also see them in Finder: select the iPhone in the sidebar,
Files tab, HomePlan Capture.

On the computer, put the unzipped folder in the repository's `scans/` folder (it is kept out
of git), or share it through Drive.

Room scans are typically 50 to 300 MB, mostly photos. The app stops taking photos after 400.

## Scanning tips

### Rooms

- **Lights on**, all of them, and open the blinds. Even light gives better photos and colours.
- **Set doors as you want them modelled.** Room doors and cabinet doors are recorded as they are
  during the scan, so close the cabinet doors and dishwasher, and set room doors open or shut as
  you want them in the plan.
- **Clear what you can** from counters and the floor. Clutter becomes boxes or hides walls.
- **Move slowly.** Walk the room in a slow sweep, pointing the phone at the walls, and move the
  phone smoothly. Fast turns blur photos and lose tracking.
- **Cover every wall from floor to ceiling**, and the floor and ceiling edges. Tilt the phone up
  and down as you go. Gaps in coverage become gaps or guesses in the model.
- **Weak spots:** mirrors, windows and glass doors, shiny or very dark surfaces (black
  appliances, dark counters, glossy tiles). Give them extra time from a few angles, and
  expect to tape measure around them.
- **Keep a scan under 5 minutes.** Longer scans drift and use a lot of memory. For a big
  space, scan one room at a time.
- Stand in one place for a second at the start so tracking settles, and follow RoomPlan's
  on-screen hints.
- When you tap Done, wait for "Saved". Building the model and colouring the mesh can take a
  minute. Keep the app open.
- The scan is a draft. Walls can be off by a few centimetres. The tape measure is the truth.

### Objects

- Put the object on a plain, non-shiny surface with space to walk all round it, in even light.
- Tap Continue, fit the box round the object, then Start capture and walk slowly round it,
  keeping it in view. The ring on screen fills as you go.
- When a pass is complete, do another pass from higher or lower, or flip the object if its
  underside matters, then Finish.
- Choose Reduced detail unless you need more. Medium takes longer and may not be supported on
  the phone, in which case the app builds at Reduced instead.
- Building the model takes several minutes. Keep the app open and the phone awake (plugging it
  in helps).
- Shiny, transparent, very thin or plain featureless objects scan badly.

## Notes for whoever fixes the build

- Sources are in `ios/HomePlanCapture/Sources` (App, Room, Object). Info.plist is
  `ios/HomePlanCapture/Support/Info.plist`.
- No third-party packages. Frameworks: SwiftUI, RoomPlan, ARKit, RealityKit, CoreImage,
  ImageIO.
- `UIRequiredDeviceCapabilities` lists `arkit` only: there is no LiDAR value for that key, so
  the app checks `RoomCaptureSession.isSupported` and `ObjectCaptureSession.isSupported` when
  you tap a scan button.
- The Swift optimisation level is "-O" in Debug too, because Run uses Debug and the mesh
  colouring loop is slow without it.
