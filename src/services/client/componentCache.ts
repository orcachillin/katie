import fs from "fs";
import path from "path";
import { Logger } from "../../util/logger.js";
import FetchCache, { CacheOptions } from "../../util/cache/fetchCache.js";
import Cache, { CacheLimitType } from "../../util/cache/cache.js";
import Core from "../../core.js";

export type ComponentMethod = (props: Record<string, any>) => any
export type Component = {

    // methods, used when requesting components directly. this does not apply to routes
    default: ComponentMethod
    get: ComponentMethod
    post?: ComponentMethod
    put?: ComponentMethod
    delete?: ComponentMethod

    // flags and options
    route?: string | string[] // assign routes to this component, rendered with the index layout
    noCache?: true // force bypass cache for these, even if cacheId is passed as props
    noOOB?: true // skip sending out of band swapped items, like the navbar

    // fallback, components can export whatever they want for map storage
    [key: string]: any
}

export default class ComponentCache extends Map<string, Component> {

    private readonly logger = new Logger("ComponentCache")
    public renderCache: Cache<string, string>
    public routes: Record<string, Component> = {}


    constructor(public readonly basePath: string, cacheOptions: CacheOptions = {
        limitBy: CacheLimitType.Time,
        staleDataThreshold: 3
    }) {
        super();
        this.renderCache = new Cache<string, string>(cacheOptions)
    }

    private scanComponents(dir: string): string[] {
        const results: string[] = [];
        const files = fs.readdirSync(dir, { withFileTypes: true });

        for (const file of files) {
            const fullPath = path.join(dir, file.name);

            if (file.isDirectory()) {
                results.push(...this.scanComponents(fullPath));
            } else if (file.name.endsWith(".js")) {
                const relativePath = path.relative(this.basePath, fullPath);
                results.push(relativePath);
            }
        }

        return results;
    }

    private async loadComponent(componentPath: string): Promise<void> {
        const id = componentPath.replace(".js", "").replace(/\//g, ".").toLowerCase()
        const fullPath = path.join(this.basePath, componentPath);

        try {

            const component = await import(fullPath)
            const clone = Object.assign({}, component)

            clone.id = id
            clone.default ? clone.get = clone.default : 0
            clone.path = fullPath
            clone.srcPath = fullPath.replace("dist", "src").replace(".js", ".tsx")

            // load routes into the router if the component specifies them
            if (clone.route) {

                // bullshit to enforce consistant typing
                if (typeof clone.route == "string") {
                    clone.route = [clone.route]
                }

                for (const route of clone.route) {
                    this.routes[route] = clone
                }

                this.logger.debug(`Applied routes: ${clone.route.join(", ")}`)
            }

            this.set(id, clone);
            this.logger.debug(`Loaded component: ${id} from ${componentPath}`);
        } catch (error) {
            this.logger.error(`Failed to load component ${componentPath}:`, error);
        }
    }

    public async init(): Promise<void> {
        const componentFiles = this.scanComponents(this.basePath);
        for (const file of componentFiles) {
            await this.loadComponent(file);
        }

        this.logger.log(`Initialized ${this.basePath.replace(path.resolve(), "")} with ${componentFiles.length} components`);
    }

    public getComponentMethod(key: string): ComponentMethod | undefined {
        return super.get(key)?.default
    }

    public async render(id: string, props: Parameters<ComponentMethod>[0] & { cacheId?: string, method?: string, cacheKey?: string }): Promise<string> {
        const component = this.get(id)
        const reqMethod = Core.services.context.get<string>("method")?.toLowerCase() || "default"
        const renderMethod = component?.[reqMethod]

        if (!component || component.noCache || !props.cacheId) {
            return renderMethod ? await renderMethod(props) : ""
        }

        const cacheKey = `${id} - ${reqMethod} - ${props.cacheId}`
        const cachedRender = this.renderCache.get(cacheKey)

        if (cachedRender) {
            this.logger.debug(`[CACHED] render: ${id}`)
            return cachedRender
        }

        props.cacheKey = cacheKey
        const res = await renderMethod(props)

        this.renderCache.set(cacheKey, res)
        return res
    }

}

