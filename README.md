# Cut It First

> Download only the part of a Google Drive video you need.

## The problem

I was on the production team at LOSTiN, a travel media startup. The video editors there worked with hour long event footage stored on shared Google Drive folders. Whenever they needed a 30 second clip from a 90 minute file, they had to download the whole thing, often 10+ GB. It clogged their drives, ate hours of their day, and they did it constantly.

I interviewed three of them to understand the workflow, then started building this.

## What it does

A Chrome extension that lives inside Google Drive. While previewing a video, you mark start and end pins on the timeline, click confirm, and only the selected segment lands in your Downloads folder, already trimmed.

You can queue multiple segments per video. Drag pins to fine tune. FFmpeg.wasm does the precise trim client side, no server.

## Status

Planning and early scaffolding. Specs live in [`TODO.md`](TODO.md) (UX) and [`TODO_technical.md`](TODO_technical.md) (implementation).

## Built by

[Atom Wang](https://github.com/atomiiw) · started 2026-03
