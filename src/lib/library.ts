/**
 * Preplan Library: DataSyncs named "Preplan Library…" whose attached .geojson
 * files are the preplans. Visibility follows the library mission's TAK groups,
 * so each user only sees the libraries their channels allow.
 */
import { server, std } from '../../../../src/std.ts';
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

function isLibrary(name: string): boolean {
    return name.toLowerCase().startsWith(LIBRARY_PREFIX.toLowerCase());
}

/** All preplan files across every library mission the user can see, sorted by name. */
export async function listPreplans(): Promise<Preplan[]> {
    const { data, error } = await server.GET('/api/marti/mission', {
        params: { query: {} as never },
    });
    if (error || !data) throw new Error('Could not list missions');

    const libraries = data.items.filter((mission) => isLibrary(mission.name));

    const preplans: Preplan[] = [];
    await Promise.all(libraries.map(async (library) => {
        const res = await server.GET('/api/marti/missions/{:guid}', {
            params: {
                path: { ':guid': library.guid },
                query: { changes: false, logs: false },
            },
        });
        if (res.error || !res.data) {
            console.warn(`[preplans] could not read library "${library.name}"`, res.error);
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

    return preplans.sort((a, b) => a.name.localeCompare(b.name) || a.library.name.localeCompare(b.library.name));
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
