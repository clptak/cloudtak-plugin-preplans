import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPreplanFile, preplanTitle, toMissionFeatures } from './convert.ts';

const now = new Date('2026-10-24T12:00:00Z');

test('plain GeoJSON gets CoT defaults, fresh ids, and keeps extra properties as metadata', () => {
    const { features, skipped } = toMissionFeatures({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            id: 'orig-1',
            properties: { name: 'Staging', description: 'Park here', agency: 'CCSO' },
            geometry: { type: 'Point', coordinates: [-111.65, 35.19] },
        }],
    }, { preplanName: 'Riverside', now });

    assert.equal(skipped, 0);
    assert.equal(features.length, 1);
    const [feat] = features;
    assert.notEqual(feat.id, 'orig-1');
    assert.equal(feat.properties.type, 'u-d-p');
    assert.equal(feat.properties.how, 'h-g-i-g-o');
    assert.equal(feat.properties.callsign, 'Staging');
    assert.equal(feat.properties.remarks, 'Park here');
    assert.deepEqual(feat.properties.center, [-111.65, 35.19]);
    assert.equal(feat.properties.time, now.toISOString());
    assert.deepEqual(feat.properties.metadata, {
        name: 'Staging',
        description: 'Park here',
        agency: 'CCSO',
        preplan: { name: 'Riverside', loaded: now.toISOString(), source_id: 'orig-1' },
    });
});

test('TAK-exported features keep type and style, drop mission and timestamp fields', () => {
    const { features } = toMissionFeatures({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            id: 'abc',
            properties: {
                id: 'abc', type: 'u-d-f', callsign: 'Sector A', stroke: '#ff0000', 'stroke-width': '4',
                'fill-opacity': 3, dest: [{ 'mission-guid': 'old' }], time: '2020-01-01T00:00:00Z',
                creator: { uid: 'x' }, archived: true,
            },
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] },
        }],
    }, { preplanName: 'Airport', now });

    const props = features[0].properties;
    assert.equal(props.type, 'u-d-f');
    assert.equal(props.callsign, 'Sector A');
    assert.equal(props.stroke, '#ff0000');
    assert.equal(props['stroke-width'], 4);
    assert.equal(props['fill-opacity'], 1);
    assert.deepEqual(props.center, [1, 1]);
    assert.equal(props.time, now.toISOString());
    for (const key of ['dest', 'creator', 'archived', 'id']) assert.ok(!(key in props), key);
});

test('multi geometries split into numbered single features, bad geometries are skipped', () => {
    const { features, skipped } = toMissionFeatures({
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                properties: { name: 'Trails' },
                geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] },
            },
            { type: 'Feature', properties: {}, geometry: null },
            { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0]] } },
        ],
    }, { preplanName: 'Riverside', now });

    assert.equal(skipped, 2);
    assert.deepEqual(features.map((f) => f.properties.callsign), ['Trails (1)', 'Trails (2)']);
    assert.ok(features.every((f) => f.geometry.type === 'LineString'));
    assert.notEqual(features[0].id, features[1].id);
});

test('unnamed features fall back to the preplan name and position', () => {
    const { features } = toMissionFeatures({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: null, geometry: { type: 'Point', coordinates: [1, 2] } }],
    }, { preplanName: 'Riverside', now });
    assert.equal(features[0].properties.callsign, 'Riverside 1');
});

test('non-GeoJSON input is rejected', () => {
    assert.throws(() => toMissionFeatures({ foo: 1 }, { preplanName: 'x' }), /not GeoJSON/);
});

test('file name helpers', () => {
    assert.equal(preplanTitle('Riverside Trailhead.geojson'), 'Riverside Trailhead');
    assert.equal(preplanTitle('a.JSON'), 'a');
    assert.ok(isPreplanFile('x.geojson'));
    assert.ok(!isPreplanFile('x.kml'));
});
