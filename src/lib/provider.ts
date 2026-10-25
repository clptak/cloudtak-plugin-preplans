/**
 * Runtime contract other plugins call (Incident Manager's Create Mission).
 * Plugins can't import each other, so this lives on `window` while the plugin
 * is enabled, the same way caltopo-sync publishes `window.__cloudtakCaltopo`.
 *
 *   window.__cloudtakPreplans.list()  -> PreplanSummary[]
 *   window.__cloudtakPreplans.load({ hash, filename, name, missionGuid, missionToken? })
 *     -> { count, skipped, folder?, warning? }
 */
import { listPreplans } from './library.ts';
import { loadPreplan, type LoadResult } from './load.ts';

export interface PreplanSummary {
    name: string;
    filename: string;
    hash: string;
    library: string;
}

export interface PreplanLoadRequest {
    name: string;
    filename: string;
    hash: string;
    missionGuid: string;
    missionToken?: string;
    folder?: string | false;
}

export interface PreplansProvider {
    list(): Promise<PreplanSummary[]>;
    load(req: PreplanLoadRequest): Promise<LoadResult>;
}

declare global {
    interface Window {
        __cloudtakPreplans?: PreplansProvider;
    }
}

export function registerProvider(): void {
    window.__cloudtakPreplans = {
        async list() {
            return (await listPreplans()).map((preplan) => ({
                name: preplan.name,
                filename: preplan.filename,
                hash: preplan.hash,
                library: preplan.library.name,
            }));
        },
        async load(req) {
            return loadPreplan({
                preplan: { name: req.name, filename: req.filename, hash: req.hash },
                missionGuid: req.missionGuid,
                missionToken: req.missionToken,
                folder: req.folder,
            });
        },
    };
}

export function unregisterProvider(): void {
    delete window.__cloudtakPreplans;
}
