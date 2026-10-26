/**
 * Preplan Library: DataSyncs named "Preplan Library…" whose attached .geojson
 * files are the preplans. Visibility follows the library mission's TAK groups,
 * so each user only sees the libraries their channels allow.
 */
import { server, std } from '../../../../src/std.ts';
import Subscription from '../../../../src/base/subscription.ts';
import { isPreplanFile, preplanTitle } from './convert.ts';

export const LIBRARY_PREFIX = 'Preplan Library';

export interface Preplan {
    /** Display name: the file name without its extension. */
    name: string;
    filename: string;
    /** TAK Server file hash, used to download it. */
    hash: string;
    size: number;
    submissionTime?: string;
    library: {
        guid: string;
        name: string;
    };
}

export interface PreplanListing {
    preplans: Preplan[];
    /** One message per library mission that was found but could not be read. */
    problems: string[];
}

function isLibrary(name: string): boolean {
    return name.trim().toLowerCase().startsWith(LIBRARY_PREFIX.toLowerCase());
}

/** The mission token CloudTAK saved when the user subscribed (needed for a password-protected library). */
async function savedToken(guid: string): Promise<string | undefined> {
    try {
        return (await Subscription.from(guid))?.missiontoken;
    } catch {
        return undefined;
    }
}

/** All preplan files across every library mission the user can see, sorted by name. */
export async function listPreplans(): Promise<PreplanListing> {
    // Same flags as CloudTAK's own Data Sync list: without passwordProtected,
    // TAK Server leaves password-protected missions out entirely.
    const { data, error } = await server.GET('/api/marti/mission', {
        params: {
            query: { passwordProtected: true, defaultRole: true } as never,
        },
    });
    if (error || !data) throw new Error('Could not list missions');

    const libraries = data.items.filter((mission) => isLibrary(mission.name));

    const preplans: Preplan[] = [];
    const problems: string[] = [];
    await Promise.all(libraries.map(async (library) => {
        const token = await savedToken(library.guid);
        const res = await server.GET('/api/marti/missions/{:guid}', {
            params: {
                path: { ':guid': library.guid },
                query: { changes: false, logs: false },
            },
            headers: token ? { MissionAuthorization: token } : {},
        });
        if (res.error || !res.data) {
            const reason = (res.error as { message?: string } | undefined)?.message ?? 'no response';
            problems.push(library.passwordProtected && !token
                ? `"${library.name}" is password protected - subscribe to it once (with its password) to read its preplans`
                : `Could not read "${library.name}": ${reason}`);
            return;
        }

        for (const content of res.data.contents ?? []) {
            const filename = content.data.name ?? '';
            if (!content.data.hash || !isPreplanFile(filename)) continue;
            preplans.push({
                name: preplanTitle(filename),
                filename,
                hash: content.data.hash,
                size: content.data.size ?? 0,
                submissionTime: content.data.submissionTime ?? content.timestamp,
                library: { guid: library.guid, name: library.name },
            });
        }
    }));

    preplans.sort((a, b) => a.name.localeCompare(b.name) || a.library.name.localeCompare(b.library.name));
    return { preplans, problems };
}

/** Download a preplan file's GeoJSON. */
export async function fetchPreplan(preplan: Pick<Preplan, 'hash' | 'filename'>): Promise<unknown> {
    const res = await std(
        `/api/marti/api/files/${encodeURIComponent(preplan.hash)}?name=${encodeURIComponent(preplan.filename)}`,
    );

    // std() parses JSON responses itself and hands back the raw Response otherwise
    // (TAK serves uploads as application/octet-stream).
    if (res instanceof Response) {
        const body = await res.text();
        try {
            return JSON.parse(body);
        } catch {
            throw new Error(`"${preplan.filename}" is not valid JSON`);
        }
    }
    return res;
}
