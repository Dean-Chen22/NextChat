import OpenAPIClientAxios from "openapi-client-axios";
import { StoreKey } from "../constant";
import { nanoid } from "nanoid";
import { createPersistStore } from "../utils/store";
import { getClientConfig } from "../config/client";
import yaml from "js-yaml";
import { adapter, getOperationId } from "../utils";
import { useAccessStore } from "./access";
import { AlibabaSearchConfig } from "../plugins/alibaba-search";

const isApp = getClientConfig()?.isApp !== false;

export const BuiltinPlugins: Plugin[] = [AlibabaSearchConfig];

export type PluginSetting = {
  type: "select" | "number";
  options?: string[];
  title: string;
  description?: string;
  min?: number;
  max?: number;
  default?: string | number;
};

export type Plugin = {
  id: string;
  createdAt: number;
  title: string;
  version: string;
  content: string;
  builtin: boolean;
  authType?: string;
  authLocation?: string;
  authHeader?: string;
  authToken?: string;
  settings?: Record<string, PluginSetting>;
};

export type FunctionToolItem = {
  type: string;
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

type FunctionToolServiceItem = {
  api: OpenAPIClientAxios;
  length: number;
  tools: FunctionToolItem[];
  funcs: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
};

export const FunctionToolService = {
  tools: {} as Record<string, FunctionToolServiceItem>,
  add(plugin: Plugin, replace = false) {
    if (!replace && this.tools[plugin.id]) return this.tools[plugin.id];
    const headerName = (
      plugin?.authType == "custom" ? plugin?.authHeader : "Authorization"
    ) as string;
    const tokenValue =
      plugin?.authType == "basic"
        ? `Basic ${plugin?.authToken}`
        : plugin?.authType == "bearer"
        ? `Bearer ${plugin?.authToken}`
        : plugin?.authToken;
    const authLocation = plugin?.authLocation || "header";
    const definition = yaml.load(plugin.content) as any;
    const serverURL = definition?.servers?.[0]?.url;
    const baseURL = !isApp ? "/api/proxy" : serverURL;
    const headers: Record<string, string | undefined> = {
      "X-Base-URL": !isApp ? serverURL : undefined,
    };
    if (authLocation == "header") {
      headers[headerName] = tokenValue;
    }
    // try using openaiApiKey for Dalle3 Plugin.
    if (!tokenValue && plugin.id === "dalle3") {
      const openaiApiKey = useAccessStore.getState().openaiApiKey;
      if (openaiApiKey) {
        headers[headerName] = `Bearer ${openaiApiKey}`;
      }
    }
    const api = new OpenAPIClientAxios({
      definition: yaml.load(plugin.content) as any,
      axiosConfigDefaults: {
        adapter: (window.__TAURI__ ? adapter : ["xhr"]) as any,
        baseURL,
        headers,
      },
    });
    try {
      api.initSync();
    } catch {}
    const operations = api.getOperations();
    return (this.tools[plugin.id] = {
      api,
      length: operations.length,
      tools: operations.map((o) => {
        // @ts-expect-error Request body content may be undefined
        const parameters = o?.requestBody?.content["application/json"]
          ?.schema || {
          type: "object",
          properties: {},
        };
        if (!parameters["required"]) {
          parameters["required"] = [];
        }
        if (o.parameters instanceof Array) {
          o.parameters.forEach((p) => {
            // @ts-expect-error Parameter may be undefined
            if (p?.in == "query" || p?.in == "path") {
              // const name = `${p.in}__${p.name}`
              // @ts-expect-error Name may be undefined
              const name = p?.name;
              parameters["properties"][name] = {
                // @ts-expect-error Schema type may be undefined
                type: p.schema.type,
                // @ts-expect-error Description may be undefined
                description: p.description,
              };
              // @ts-expect-error Required field may be undefined
              if (p.required) {
                parameters["required"].push(name);
              }
            }
          });
        }
        return {
          type: "function",
          function: {
            name: getOperationId(o),
            description: o.description || o.summary,
            parameters: parameters,
          },
        } as FunctionToolItem;
      }),
      funcs: operations.reduce((s, o) => {
        // @ts-expect-error Function parameters are dynamic
        s[getOperationId(o)] = function (args) {
          const parameters: Record<string, any> = {};
          if (o.parameters instanceof Array) {
            o.parameters.forEach((p) => {
              // @ts-expect-error Parameter name may be undefined
              parameters[p?.name] = args[p?.name];
              // @ts-expect-error Parameter name may be undefined
              delete args[p?.name];
            });
          }
          if (authLocation == "query") {
            parameters[headerName] = tokenValue;
          } else if (authLocation == "body") {
            args[headerName] = tokenValue;
          }
          // @ts-expect-error Operation ID may be null, fallback to path and method
          return api.client.paths[o.path][o.method](
            parameters,
            args,
            api.axiosConfigDefaults,
          );
        };
        return s;
      }, {}),
    });
  },
  get(id: string) {
    return this.tools[id];
  },
};

export const createEmptyPlugin = () =>
  ({
    id: nanoid(),
    title: "",
    version: "1.0.0",
    content: "",
    builtin: false,
    createdAt: Date.now(),
  }) as Plugin;

export const DEFAULT_PLUGIN_STATE = {
  plugins: {} as Record<string, Plugin>,
};

export const usePluginStore = createPersistStore(
  { ...DEFAULT_PLUGIN_STATE },

  (set, get) => ({
    create(plugin?: Partial<Plugin>) {
      const plugins = get().plugins;
      const id = plugin?.id || nanoid();
      plugins[id] = {
        ...createEmptyPlugin(),
        ...plugin,
        id,
        builtin: false,
      };

      set(() => ({ plugins }));
      get().markUpdate();

      return plugins[id];
    },
    updatePlugin(id: string, updater: (plugin: Plugin) => void) {
      const plugins = get().plugins;
      const plugin = plugins[id];
      if (!plugin) return;
      const updatePlugin = { ...plugin };
      updater(updatePlugin);
      plugins[id] = updatePlugin;
      FunctionToolService.add(updatePlugin, true);
      set(() => ({ plugins }));
      get().markUpdate();
    },
    delete(id: string) {
      const plugins = get().plugins;
      delete plugins[id];
      set(() => ({ plugins }));
      get().markUpdate();
    },

    getAsTools(ids: string[]) {
      const plugins = get().plugins;
      const selected = (ids || [])
        .map((id) => plugins[id])
        .filter((i) => i)
        .map((p) => FunctionToolService.add(p));
      return [
        // @ts-expect-error Tools array concatenation
        selected.reduce((s, i) => s.concat(i.tools), []),
        selected.reduce((s, i) => Object.assign(s, i.funcs), {}),
      ];
    },
    get(id?: string) {
      return get().plugins[id ?? 1145141919810];
    },
    getAll() {
      return Object.values(get().plugins).sort(
        (a, b) => b.createdAt - a.createdAt,
      );
    },
  }),
  {
    name: StoreKey.Plugin,
    version: 1,
    onRehydrateStorage(state) {
      // Skip store rehydration on server side
      if (typeof window === "undefined") {
        return;
      }

      fetch("./plugins.json")
        .then((res) => res.json())
        .then((res) => {
          Promise.all(
            res.map((item: any) =>
              // skip get schema
              state.get(item.id)
                ? item
                : fetch(item.schema)
                    .then((res) => res.text())
                    .then((content) => ({
                      ...item,
                      content,
                    }))
                    .catch(() => item),
            ),
          ).then((builtinPlugins: any) => {
            builtinPlugins
              .filter((item: any) => item?.content)
              .forEach((item: any) => {
                const plugin = state.create(item);
                state.updatePlugin(plugin.id, (plugin) => {
                  const tool = FunctionToolService.add(plugin, true);
                  plugin.title = tool.api.definition.info.title;
                  plugin.version = tool.api.definition.info.version;
                  plugin.builtin = true;
                });
              });
          });
        });
    },
  },
);
