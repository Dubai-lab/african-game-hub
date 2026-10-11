// Makes the two copies of the word list the word game checks words against.
// Usage: node scripts/makeWordList.ts <path to enable1.txt>
//
// The list is ENABLE ("Enhanced North American Benchmark LExicon"), which its authors placed
// in the public domain (see ASSETS.md). Words of 2 to 15 letters, a to z only, one per line.
//   public/words/en.txt                         fetched by the app, only for practice against the computer
//   supabase/functions/_shared/wordlist.en.ts   part of the server function that judges every word
import { readFileSync, writeFileSync } from 'node:fs'

const source = process.argv[2]
if (!source) throw new Error('Say where the word list is: node scripts/makeWordList.ts <path to enable1.txt>')
const words = [...new Set(readFileSync(source, 'utf8').split(/\r?\n/).map((word) => word.trim().toLowerCase()))].filter((word) => /^[a-z]{2,15}$/.test(word)).sort()
if (words.length < 150_000) throw new Error(`Only ${words.length} words: that is not the whole list`)

writeFileSync('public/words/en.txt', words.join('\n') + '\n')
writeFileSync(
  'supabase/functions/_shared/wordlist.en.ts',
  `// The English word list (ENABLE, public domain: see ASSETS.md). Made by scripts/makeWordList.ts; do not edit by hand.\n// ${words.length} words of 2 to 15 letters, one per line.\nexport const WORD_LIST_EN = \`${words.join('\n')}\`\n`,
)
console.log(`${words.length} words written`)
