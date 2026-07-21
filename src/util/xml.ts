export default class XML {
    public static format(key: string, data: { [key: string]: string | undefined }, content?: string) {
        return `<${key} ${(Object.entries(data).filter(e => Boolean(e[1])) as [string, string][]).map(e => `${e[0]}="${e[1].replaceAll('"', '\\"')}"`).join(' ')}${!content ? "/" : ""}>${!content ? '' : `${content}</${key}>`}`
    }
}
