<template>
    <MenuTemplate
        name='Preplans'
        :loading='loading'
    >
        <template #buttons>
            <TablerIconButton
                title='Refresh'
                @click='refresh'
            >
                <IconRefresh
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>
        </template>

        <div class='px-3 py-2'>
            <div
                v-if='target'
                class='text-secondary small mb-2'
            >
                Loads into the active mission: <strong v-text='target.name' />
            </div>
            <TablerInlineAlert
                v-else
                severity='warning'
                title='No active mission'
                description='Open a mission and make it active, then load a preplan into it.'
            />

            <TablerInlineAlert
                v-if='status'
                class='my-2'
                :severity='statusError ? "danger" : "success"'
                :title='statusError ? "Error" : "Preplan loaded"'
                :description='status'
            />

            <TablerInlineAlert
                v-for='problem in problems'
                :key='problem'
                class='my-2'
                severity='warning'
                title='Library not readable'
                :description='problem'
            />

            <TablerInlineAlert
                v-if='listError'
                class='my-2'
                severity='danger'
                title='Could not list preplans'
                :description='listError'
            />
            <TablerNone
                v-else-if='!loading && !preplans.length && !problems.length'
                label='No preplans'
                :create='false'
            />
            <div
                v-else-if='!loading && preplans.length'
                class='text-secondary small'
            >
                Files in DataSyncs named "{{ LIBRARY_PREFIX }}…"
            </div>
        </div>

        <div
            v-for='preplan in preplans'
            :key='preplan.library.guid + preplan.hash'
            class='d-flex align-items-center px-3 py-2 hover'
        >
            <IconMapPin
                :size='24'
                stroke='1'
            />
            <div
                class='mx-2 flex-grow-1'
                style='min-width: 0'
            >
                <div
                    class='text-truncate'
                    v-text='preplan.name'
                />
                <div
                    v-if='libraryCount > 1'
                    class='subheader text-truncate'
                    v-text='preplan.library.name'
                />
            </div>
            <button
                class='btn btn-sm btn-primary'
                :disabled='!target || loadingHash !== null'
                @click='load(preplan)'
            >
                {{ loadingHash === preplan.hash ? 'Loading…' : 'Load' }}
            </button>
        </div>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { computed, onMounted, ref } from 'vue';
import { IconMapPin, IconRefresh } from '@tabler/icons-vue';
import { TablerIconButton, TablerInlineAlert, TablerNone } from '@tak-ps/vue-tabler';
import MenuTemplate from '../../../../src/components/CloudTAK/util/MenuTemplate.vue';
import { useMapStore } from '../../../../src/stores/map.ts';
import { LIBRARY_PREFIX, listPreplans, type Preplan } from '../lib/library.ts';
import { loadPreplan } from '../lib/load.ts';

const mapStore = useMapStore();

const loading = ref(false);
const listError = ref('');
const preplans = ref<Preplan[]>([]);
const problems = ref<string[]>([]);
const loadingHash = ref<string | null>(null);
const status = ref('');
const statusError = ref(false);

const target = computed(() => {
    const mission = mapStore.mission;
    if (!mission) return undefined;
    return { guid: mission.guid, name: mission.meta.name, token: mission.missiontoken };
});

const libraryCount = computed(() => new Set(preplans.value.map((p) => p.library.guid)).size);

async function refresh(): Promise<void> {
    loading.value = true;
    listError.value = '';
    try {
        ({ preplans: preplans.value, problems: problems.value } = await listPreplans());
    } catch (err) {
        listError.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}

async function load(preplan: Preplan): Promise<void> {
    const mission = target.value;
    if (!mission) return;

    loadingHash.value = preplan.hash;
    status.value = '';
    statusError.value = false;
    try {
        const result = await loadPreplan({
            preplan,
            missionGuid: mission.guid,
            missionToken: mission.token,
        });
        status.value = `${result.count} objects from "${preplan.name}" copied into "${mission.name}"`
            + (result.folder ? `, folder "${result.folder}".` : '.')
            + (result.skipped ? ` ${result.skipped} without a usable geometry were skipped.` : '')
            + (result.warning ? ` ${result.warning}` : '');
    } catch (err) {
        statusError.value = true;
        status.value = err instanceof Error ? err.message : String(err);
    } finally {
        loadingHash.value = null;
    }
}

onMounted(refresh);
</script>
