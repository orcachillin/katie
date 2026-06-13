const QWERTY_ROW = "qwertyuiop"
const ASDF_ROW = "asdfghjkl"
const ZXCV_ROW = "zxcvbnm"

function nearbyKey(char: string): string {
    const lower = char.toLowerCase()
    const row = QWERTY_ROW.includes(lower) ? QWERTY_ROW
        : ASDF_ROW.includes(lower) ? ASDF_ROW
        : ZXCV_ROW.includes(lower) ? ZXCV_ROW
        : null
    if (!row) return char
    const idx = row.indexOf(lower)
    const neighbors = [row[idx - 1], row[idx + 1]].filter(Boolean)
    if (neighbors.length === 0) return char
    const replacement = neighbors[Math.floor(Math.random() * neighbors.length)]
    return char === lower ? replacement : replacement.toUpperCase()
}

export function typoify(text: string): string | null {
    const words = text.split(/\s+/)
    if (words.length < 2) return null

    const pick = Math.floor(Math.random() * words.length)
    const word = words[pick]
    if (word.length < 3) return null

    const type = Math.random()
    let mangled: string

    if (type < 0.35) {
        // transpose two adjacent characters
        const i = 1 + Math.floor(Math.random() * (word.length - 2))
        mangled = word.slice(0, i - 1) + word[i] + word[i - 1] + word.slice(i + 1)
    } else if (type < 0.6) {
        // double a character
        const i = Math.floor(Math.random() * word.length)
        mangled = word.slice(0, i) + word[i] + word[i] + word.slice(i + 1)
    } else if (type < 0.85) {
        // omit a character
        const i = Math.floor(Math.random() * word.length)
        mangled = word.slice(0, i) + word.slice(i + 1)
    } else {
        // nearby key replacement
        const i = Math.floor(Math.random() * word.length)
        mangled = word.slice(0, i) + nearbyKey(word[i]) + word.slice(i + 1)
    }

    if (mangled === word) return null
    words[pick] = mangled
    return words.join(" ")
}