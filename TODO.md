# Cut It First — TODO

## Step 1: Selection UI
Inject a small UI onto the Google Drive video page that lets the user mark the start and end time of the clip they want to download. The UI should sit alongside the existing video player and show the selected range clearly.

### Step 1a: Start and end pins
The extension detects whether the Google Drive video player is playing or paused.

When the video is paused, a small button appears above the progress bar's playhead:
- If no start has been set yet, the button reads **"Mark Start"**. The user can click it to set the current position as the beginning of their clip, or just ignore it.
- Once the start is set, the next time the video pauses the button reads **"Mark End"**. The end position must be later than the start — if the user pauses at an earlier point, the button should not appear (or be disabled).
- Once the end is set, a highlighted segment appears on the progress bar between the two points. A small checkmark button appears for the user to confirm/approve the segment.
- When the user clicks the checkmark, the segment changes color to indicate it is locked and finalized — no longer subject to change.

### Step 1b: Deletion
- A start pin can only be deleted before the end has been set.
- An end pin can only be deleted before the segment has been confirmed with the checkmark.
- In other words, you can only undo the most recent action — once you move forward (setting end after start, or confirming after end), the previous step is locked.
- Pressing Cmd+Z (or Ctrl+Z) also undoes the most recent action, same as clicking the delete button.
- A fully confirmed/locked segment can be deleted as a whole.

### Step 1c: Editing
- A finalized segment shows a pencil icon next to the trashcan. Clicking it reopens the segment for editing — specifically, it returns to the state where the end pin is set but not yet confirmed. From there the user can delete the end pin, adjust it, etc.
- While in edit mode (i.e. after clicking the pencil icon on a finalized segment), pins can be dragged along the progress bar:
  - Both start and end pins are draggable.
  - Start can never be dragged past end, and end can never be dragged before start.
  - A pin snaps/magnets to the current playhead position when dragged close to it.

### Step 1d: Multiple segments
The user can add more than one segment. Each segment has its own start/end pins and visual guide, so the user can queue up several clips to download at once.

## Step 2: Grab the video URL
Extract the actual video file URL from the page's network traffic. For debugging: display the captured URL to the user so they can open it manually and confirm it leads to the correct video.

## Step 3: Fetch the rough segment
Using the start and end times the user selected, fetch roughly the right portion of the video file using a Range request. For debugging: let the user download this rough cut so they can verify it contains the segment they want (it may have extra footage at the start/end — that's expected).

## Step 4: Precise trim with FFmpeg
Use FFmpeg.wasm to trim the rough segment precisely to the user's selected start and end times, producing a clean .mp4 file.

## Step 5: Save to Downloads
Save the final .mp4 to the user's Downloads folder. Name it using the original video name plus the time range, e.g. `My Video_0:10_to_0:30.mp4`.
