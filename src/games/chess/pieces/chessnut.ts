// Chessnut pieces by Alexis Luengas, Apache License 2.0. See ASSETS.md.
const files = import.meta.glob<string>('./chessnut/*.svg', { eager: true, query: '?url', import: 'default' })
export default files
