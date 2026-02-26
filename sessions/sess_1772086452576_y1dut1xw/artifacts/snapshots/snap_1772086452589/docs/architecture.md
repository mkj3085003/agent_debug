# Architecture Overview

This repo is a monorepo with CLI and Viewer apps plus core packages.

## Data flow
1) CLI wrapper launches agent run and emits events.
2) Recorder streams JSONL events to the store.
3) Diff engine records patches as file artifacts.
4) Viewer reads JSONL + artifacts to render timeline.
5) Replay engine supports replay and rerun modes.

## Core contracts
- Event schema is defined in packages/shared.
- Storage layout is defined in packages/store.
- CLI and Viewer only depend on public package APIs.
