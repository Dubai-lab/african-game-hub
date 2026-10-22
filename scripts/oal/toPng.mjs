// Every texture of a GLB as PNG (decoded from WebP/JPEG), the file written unpacked: for KTX2 encoding.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { dequantize } from '@gltf-transform/functions'
import sharp from 'sharp'
const [, , input, output] = process.argv
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(input)
for (const tex of doc.getRoot().listTextures()) {
  const img = tex.getImage()
  if (!img) continue
  tex.setImage(await sharp(Buffer.from(img)).png({ compressionLevel: 1 }).toBuffer()).setMimeType('image/png')
}
// (Its shapes back to plain numbers: packed again from those, not from packed ones.)
await doc.transform(dequantize())
for (const ext of doc.getRoot().listExtensionsUsed()) {
  const n = ext.extensionName
  if (n === 'EXT_texture_webp' || n === 'EXT_meshopt_compression' || n === 'KHR_texture_basisu' || n === 'KHR_mesh_quantization') ext.dispose()
}
await io.write(output, doc)
console.log('PNG', output)
