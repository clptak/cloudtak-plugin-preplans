import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPreplanFile, preplanTitle, toMissionFeatures } from './convert.ts';

const now = new Date('2026-10-24T12:00:00Z');

test('plain GeoJSON gets CoT defaults, fresh ids, and extra properties in remarks', () => {
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
    assert.equal(feat.properties.remarks, 'Park here\n\nagency: CCSO');
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

test('extra properties become remarks lines without a description; empty and simplestyle-only keys are left out', () => {
    const { features } = toMissionFeatures({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {
                name: 'LZ', radio: 'TAC 2', capacity: 2, contacts: ['Base', 'Air'], blank: '  ',
                empty: {}, 'marker-symbol': 'heliport', 'marker-size': 'large',
            },
            geometry: { type: 'Point', coordinates: [1, 2] },
        }],
    }, { preplanName: 'Riverside', now });
    assert.equal(features[0].properties.remarks, 'radio: TAC 2\ncapacity: 2\ncontacts: ["Base","Air"]');
});

test('features with nothing extra get no remarks', () => {
    const { features } = toMissionFeatures({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { name: 'Gate' }, geometry: { type: 'Point', coordinates: [1, 2] } }],
    }, { preplanName: 'Riverside', now });
    assert.ok(!('remarks' in features[0].properties));
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
