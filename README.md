# cloudtak-plugin-preplans

A CloudTAK plugin that copies a preplan into a mission. The copy is made of fresh map objects, so loading the same preplan into many incidents never links those incidents' objects together.

## How it works

- **Library:** preplans are `.geojson` files attached to any DataSync whose name starts with `Preplan Library`. The library mission's TAK groups decide who can see which preplans.
- **Load:** the plugin downloads the file and gives every feature a new UID. Multi-geometries are split, and properties CoT doesn't support are kept under `metadata`. The objects are submitted through `PUT /api/marti/missions/:guid/cot`, which confirms that every object reached the mission. They're then filed under a `Preplan - <name>` folder.
- **Where to use it:**
  - **Menu → Preplans** loads into the active mission.
  - Other plugins can call `window.__cloudtakPreplans`. Incident Manager's Create Mission uses it (`list()`, `load({ name, filename, hash, missionGuid, missionToken? })`).

## Setting up a library

1. Create a DataSync named `Preplan Library` (or `Preplan Library - SAR`, etc.). Put it in the groups that should load preplans and give it a read-only default role.
2. Upload preplan files to it from the DataSync's Files tab. The file name, without `.geojson`, is the preplan's name.
3. To make a preplan from an old mission, export that mission as GeoJSON (`GET /api/marti/missions/:guid/archive?format=geojson`), trim it, rename it and upload it.

## Install

This is a build-time web plugin. Symlink or copy it to `app/plugins/preplans` in CloudTAK, or add it to `WEB_PLUGINS`.

```bash
npm test   # converter tests (node --test)
```
