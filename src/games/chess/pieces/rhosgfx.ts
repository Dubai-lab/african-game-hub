// RhosGFX pieces by RhosGFX, CC0 1.0 (public domain). See ASSETS.md.
const files = import.meta.glob<string>('./rhosgfx/*.svg', { eager: true, query: '?url', import: 'default' })
export default files
