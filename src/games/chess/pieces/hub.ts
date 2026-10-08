// "Solid": the hub's own pieces, drawn for this project by scripts/makePieces.ts. See ASSETS.md.
const files = import.meta.glob<string>('./hub/*.svg', { eager: true, query: '?url', import: 'default' })
export default files
