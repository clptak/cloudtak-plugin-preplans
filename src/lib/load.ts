/**
 * Copy a preplan into a mission: fresh CoTs through the confirmed bulk submit
 * (PUT /api/marti/missions/:guid/cot), filed under a "Preplan - <name>" folder.
 */
import { server, std } from '../../../../src/std.ts';
import Subscription from '../../../../src/base/subscription.ts';
import type { MissionLayer } from '../../../../src/types.ts';
import { toMissionFeatures, type PreplanFeature } from './convert.ts';
import { fetchPreplan, type Preplan } from './library.ts';

/**
 * Each submit builds a Data Package, uploads it and waits for TAK Server to
 * confirm every CoT, which can outlast the `server` client's fixed 20s cap
 * on a busy server. Smaller batches with their own longer limit keep each
 * request well inside it. (The route itself accepts up to 100.)
 */
const SUBMIT_BATCH = 25;
const SUBMIT_TIMEOUT_MS = 120_000;

/** Filing only references existing UIDs, so it can go in the route's full 100. */
const FILE_BATCH = 100;

export interface LoadRequest {
    preplan: Pick<Preplan, 'name' | 'hash' | 'filename'>;
    missionGuid: string;
    missionToken?: string;
    /** Folder to file the objects under; defaults to "Preplan - <name>", false for mission root. */
    folder?: string | false;
}

export interface LoadResult {
    count: number;
    skipped: number;
    folder?: string;
    /** Set when the objects landed in the mission but could not be filed into the folder. */
    warning?: string;
}

export function folderName(preplanName: string): string {
    return `Preplan - ${preplanName}`;
}

function headers(token?: string): Record<string, string> {
    return token ? { MissionAuthorization: token } : {};
}

/** Layer create responses may be the layer, `{ data: layer }`, or a deeper TAKItem wrap. */
function unwrapLayer(data: unknown): MissionLayer | undefined {
    let cur: unknown = data;
    for (let i = 0; i < 3; i++) {
        if (!cur || typeof cur !== 'object') return undefined;
        const obj = cur as Record<string, unknown>;
        if (typeof obj.uid === 'string') return obj as unknown as MissionLayer;
        cur = obj.data;
    }
    return undefined;
}

async function ensureFolder(guid: string, name: string, token?: string): Promise<string> {
    const list = await server.GET('/api/marti/missions/{:guid}/layer', {
        params: { path: { ':guid': guid } },
        headers: headers(token),
    });
    const existing = (list.data?.data ?? []).find((layer) => layer.name === name && layer.type === 'UID');
    if (existing) return existing.uid;

    const { data, error } = await server.POST('/api/marti/missions/{:guid}/layer', {
        params: { path: { ':guid': guid } },
        headers: headers(token),
        body: { name, type: 'UID' },
    });
    const created = unwrapLayer(data);
    if (error || !created) throw new Error(`Could not create the "${name}" folder`);
    return created.uid;
}

async function submit(guid: string, features: PreplanFeature[], token?: string): Promise<string[]> {
    const uids: string[] = [];
    for (let i = 0; i < features.length; i += SUBMIT_BATCH) {
        try {
            const res = await std(`/api/marti/missions/${encodeURIComponent(guid)}/cot`, {
                method: 'PUT',
                headers: headers(token),
                body: { features: features.slice(i, i + SUBMIT_BATCH) },
                timeout: SUBMIT_TIMEOUT_MS,
            }) as { uids?: string[] };
            if (!Array.isArray(res?.uids)) throw new Error('no confirmation from the server');
            uids.push(...res.uids);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const done = `${uids.length} of ${features.length} objects were confirmed in the mission`;
            // A timeout only stops this browser waiting - the server may still
            // finish the batch, so loading again could duplicate objects.
            const note = /timed out/i.test(message)
                ? ' The rest may still arrive; check the mission before loading this preplan again.'
                : '';
            throw new Error(`Preplan load stopped: ${message}. ${done}.${note}`, { cause: err });
        }
    }
    return uids;
}

async function file(guid: string, folderUid: string, uids: string[], token?: string): Promise<void> {
    for (let i = 0; i < uids.length; i += FILE_BATCH) {
        const { error } = await server.PUT('/api/marti/missions/{:guid}/layer/{:uid}/cot', {
            params: { path: { ':guid': guid, ':uid': folderUid } },
            headers: headers(token),
            body: { uids: uids.slice(i, i + FILE_BATCH) },
        });
        if (error) throw new Error(error.message);
    }
}

export async function loadPreplan(req: LoadRequest): Promise<LoadResult> {
    const geojson = await fetchPreplan(req.preplan);
    const { features, skipped } = toMissionFeatures(geojson, { preplanName: req.preplan.name });
    if (!features.length) throw new Error(`"${req.preplan.filename}" has no map objects to load`);

    const folder = req.folder === false ? undefined : (req.folder || folderName(req.preplan.name));
    const result: LoadResult = { count: 0, skipped, folder };

    // The folder is created first so a permissions problem fails before
    // anything is written, but filing is best-effort once objects are in.
    const folderUid = folder ? await ensureFolder(req.missionGuid, folder, req.missionToken) : undefined;

    const uids = await submit(req.missionGuid, features, req.missionToken);
    result.count = uids.length;

    if (folderUid) {
        try {
            await file(req.missionGuid, folderUid, uids, req.missionToken);
        } catch (err) {
            result.warning = `Loaded, but could not file into "${folder}": ${err instanceof Error ? err.message : String(err)}`;
        }
    }

    // Show the copies right away on this client; other subscribers get them
    // through TAK Server. Non-fatal: the objects are already in the mission.
    try {
        const sub = await Subscription.from(req.missionGuid);
        if (sub) await sub.refresh();
    } catch (err) {
        console.warn('[preplans] loaded, but the local mission refresh failed', err);
    }

    return result;
}
