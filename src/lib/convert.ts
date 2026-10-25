/**
 * Turn a preplan GeoJSON file into features PUT /api/marti/missions/:guid/cot
 * accepts. Pure (no host imports) so it runs under `node --test`.
 *
 * Every load gets fresh UIDs: TAK Server treats a CoT uid as one object, so
 * reusing the file's ids would tie two incidents' copies together.
 */

export interface PreplanGeometry {
    type: 'Point' | 'LineString' | 'Polygon';
    coordinates: unknown;
}

export interface PreplanFeature {
    id: string;
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: PreplanGeometry;
}

interface SourceGeometry {
    type?: string;
    coordinates?: unknown;
    geometries?: SourceGeometry[];
}

interface SourceFeature {
    id?: unknown;
    type?: string;
    properties?: Record<string, unknown> | null;
    geometry?: SourceGeometry | null;
}

/**
 * Top-level CoT feature properties (node-cot Feature.Properties). The API
 * strips anything else silently, so other keys are kept under `metadata`.
 */
const COT_KEYS = new Set([
    'callsign', 'type', 'how', 'minzoom', 'maxzoom', 'rotate', 'range', 'bearing',
    'course', 'slope', 'speed', 'labels', 'marker-color', 'marker-opacity', 'stroke',
    'stroke-opacity', 'stroke-width', 'stroke-style', 'fill', 'fill-opacity', 'metadata',
    'geofence', 'contact', 'shape', 'remarks', 'milsym', 'milicon', 'image', 'sensor',
    'video', 'links', 'track', 'icon', 'droid', 'takv', 'group', 'status',
    'precisionlocation', 'flow', 'radsensordetail', 'chemsensordetail',
    'biosensordetail', 'spatial',
]);

/**
 * Properties that belong to the original object or its old mission, not the
 * copy. Timestamps and center are set fresh; attachments reference hashes the
 * copy has no claim to.
 */
const DROP_KEYS = new Set([
    'id', 'dest', 'mission', 'chat', 'attachments', 'fileshare', 'ackrequest',
    'archived', 'marti_archive', 'forcedelete', 'creator', 'center', 'time',
    'start', 'stale',
]);

const NUMERIC_KEYS = ['stroke-width', 'marker-opacity', 'stroke-opacity', 'fill-opacity'];
const OPACITY_KEYS = new Set(['marker-opacity', 'stroke-opacity', 'fill-opacity']);

const DEFAULT_TYPE: Record<PreplanGeometry['type'], string> = {
    Point: 'u-d-p',
    LineString: 'u-d-f',
    Polygon: 'u-d-f',
};

/** One year; mission content persists regardless, this only keeps clients from greying it out. */
const STALE_MS = 1000 * 60 * 60 * 24 * 365;

function uuid(): string {
    return globalThis.crypto.randomUUID();
}

/** Split Multi* geometries and GeometryCollections into the single types CoT supports. */
function explode(geometry: SourceGeometry | null | undefined): PreplanGeometry[] {
    if (!geometry || typeof geometry.type !== 'string') return [];

    switch (geometry.type) {
        case 'Point':
        case 'LineString':
        case 'Polygon':
            return Array.isArray(geometry.coordinates)
                ? [{ type: geometry.type, coordinates: geometry.coordinates }]
                : [];
        case 'MultiPoint':
        case 'MultiLineString':
        case 'MultiPolygon': {
            if (!Array.isArray(geometry.coordinates)) return [];
            const type = geometry.type.replace(/^Multi/, '') as PreplanGeometry['type'];
            return geometry.coordinates.map((coordinates) => ({ type, coordinates }));
        }
        case 'GeometryCollection':
            return (geometry.geometries ?? []).flatMap(explode);
        default:
            return [];
    }
}

function positions(geometry: PreplanGeometry): number[][] {
    if (geometry.type === 'Point') return [geometry.coordinates as number[]];
    if (geometry.type === 'LineString') return geometry.coordinates as number[][];
    return (geometry.coordinates as number[][][])[0] ?? [];
}

/** Point itself, otherwise the bounding-box center: cheap and stable enough for a label anchor. */
function center(geometry: PreplanGeometry): [number, number] {
    const pts = positions(geometry);
    if (geometry.type === 'Point') return [pts[0][0], pts[0][1]];

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function validPosition(pos: unknown): boolean {
    return Array.isArray(pos)
        && pos.length >= 2
        && typeof pos[0] === 'number' && Number.isFinite(pos[0])
        && typeof pos[1] === 'number' && Number.isFinite(pos[1]);
}

function validGeometry(geometry: PreplanGeometry): boolean {
    if (geometry.type === 'Point') return validPosition(geometry.coordinates);
    if (geometry.type === 'LineString') {
        const line = geometry.coordinates;
        return Array.isArray(line) && line.length >= 2 && line.every(validPosition);
    }
    const rings = geometry.coordinates;
    return Array.isArray(rings) && rings.length > 0 && rings.every((ring) =>
        Array.isArray(ring) && ring.length >= 4 && ring.every(validPosition));
}

function text(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
}

/**
 * Split the source properties into CoT properties and leftovers for
 * `metadata`, coercing numeric styles so one bad value can't fail the batch.
 */
function sanitize(source: Record<string, unknown>): {
    props: Record<string, unknown>;
    extra: Record<string, unknown>;
} {
    const props: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(source)) {
        if (value === null || value === undefined || DROP_KEYS.has(key)) continue;
        if (COT_KEYS.has(key)) props[key] = value;
        else extra[key] = value;
    }

    for (const key of NUMERIC_KEYS) {
        if (!(key in props)) continue;
        const num = Number(props[key]);
        if (!Number.isFinite(num)) {
            delete props[key];
        } else {
            props[key] = OPACITY_KEYS.has(key) ? Math.min(1, Math.max(0, num)) : num;
        }
    }

    for (const key of ['callsign', 'type', 'how', 'remarks', 'icon', 'stroke', 'fill', 'marker-color', 'stroke-style']) {
        if (key in props && typeof props[key] !== 'string') delete props[key];
    }

    if (props.metadata && (typeof props.metadata !== 'object' || Array.isArray(props.metadata))) {
        extra.metadata = props.metadata;
        delete props.metadata;
    }

    return { props, extra };
}

export interface ConvertOptions {
    /** Shown as the fallback callsign and recorded in each feature's metadata. */
    preplanName: string;
    now?: Date;
}

export interface ConvertResult {
    features: PreplanFeature[];
    /** Source features dropped for having no usable geometry. */
    skipped: number;
}

export function toMissionFeatures(input: unknown, opts: ConvertOptions): ConvertResult {
    const collection = input as { type?: string; features?: unknown } | null;
    let sources: SourceFeature[];
    if (collection?.type === 'FeatureCollection' && Array.isArray(collection.features)) {
        sources = collection.features as SourceFeature[];
    } else if (collection?.type === 'Feature') {
        sources = [collection as SourceFeature];
    } else {
        throw new Error('Preplan file is not GeoJSON (expected a FeatureCollection)');
    }

    const now = opts.now ?? new Date();
    const time = now.toISOString();
    const stale = new Date(now.getTime() + STALE_MS).toISOString();

    const features: PreplanFeature[] = [];
    let skipped = 0;

    sources.forEach((source, index) => {
        const parts = explode(source?.geometry).filter(validGeometry);
        if (!parts.length) {
            skipped++;
            return;
        }

        const raw = source.properties && typeof source.properties === 'object' ? source.properties : {};
        const { props, extra } = sanitize(raw);

        const label = text(props.callsign)
            ?? text(raw.name)
            ?? text(raw.title)
            ?? `${opts.preplanName} ${index + 1}`;
        const remarks = text(props.remarks) ?? text(raw.description);
        const sourceId = source.id ?? raw.id;

        parts.forEach((geometry, part) => {
            const id = uuid();
            const metadata: Record<string, unknown> = {
                ...(props.metadata as Record<string, unknown> | undefined),
                ...extra,
                preplan: {
                    name: opts.preplanName,
                    loaded: time,
                    ...(sourceId !== undefined ? { source_id: String(sourceId) } : {}),
                },
            };

            const properties: Record<string, unknown> = {
                ...props,
                type: text(props.type) ?? DEFAULT_TYPE[geometry.type],
                how: text(props.how) ?? 'h-g-i-g-o',
                callsign: parts.length > 1 ? `${label} (${part + 1})` : label,
                center: center(geometry),
                time,
                start: time,
                stale,
                metadata,
            };
            if (remarks) properties.remarks = remarks;
            else delete properties.remarks;

            features.push({ id, type: 'Feature', properties, geometry });
        });
    });

    return { features, skipped };
}

/** "Riverside Trailhead.geojson" -> "Riverside Trailhead" */
export function preplanTitle(filename: string): string {
    return filename.replace(/\.(geo)?json$/i, '').trim() || filename;
}

export function isPreplanFile(filename: string): boolean {
    return /\.(geo)?json$/i.test(filename);
}
