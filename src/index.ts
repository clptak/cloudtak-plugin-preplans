import type { App } from 'vue';
import { defineAsyncComponent, markRaw } from 'vue';
import { IconMapPins } from '@tabler/icons-vue';
import type { PluginAPI, PluginInstance, PluginStatic } from '../../../plugin.ts';
import { registerProvider, unregisterProvider } from './lib/provider.ts';

const PreplanMenu = defineAsyncComponent(() => import('./components/PreplanMenu.vue'));

const MENU_KEY = 'preplans';
const ROUTE_NAME = 'home-menu-preplans';
const ROUTE_PATH = 'preplans';

export default class PreplansPlugin implements PluginInstance {
    api: PluginAPI;

    constructor(api: PluginAPI) {
        this.api = api;
    }

    static async install(_app: App, api: PluginAPI): Promise<PluginInstance> {
        api.routes.add({
            path: ROUTE_PATH,
            name: ROUTE_NAME,
            component: PreplanMenu,
        }, 'home-menu');

        return new PreplansPlugin(api);
    }

    async enable(): Promise<void> {
        registerProvider();

        this.api.menu.add({
            key: MENU_KEY,
            label: 'Preplans',
            route: ROUTE_NAME,
            tooltip: 'Load a preplan into the active mission',
            description: 'Copy preplan map objects from a Preplan Library',
            icon: markRaw(IconMapPins) as unknown as MenuItemIconType,
        } as MenuItemConfig);
    }

    async disable(): Promise<void> {
        unregisterProvider();
        this.api.menu.remove(MENU_KEY);
    }
}

type MenuItemIconType = NonNullable<Parameters<PluginAPI['menu']['add']>[0]['icon']>;
type MenuItemConfig = Parameters<PluginAPI['menu']['add']>[0];

export const _typecheck = PreplansPlugin as unknown as PluginStatic;
