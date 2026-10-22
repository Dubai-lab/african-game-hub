// Every texture of a GLB as PNG (decoded from WebP/JPEG), the file written unpacked: for KTX2 encoding.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { dequantize, simplifyPrimitive, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
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
// Far versions made light (SIMPLIFY="<name pattern>=<share kept>"): every mesh under a node
// whose name matches, its triangles cut to that share (its outline kept).
if (process.env.SIMPLIFY) {
  await MeshoptSimplifier.ready
  await doc.transform(weld())
  const [pattern, share] = process.env.SIMPLIFY.split('=')
  const re = new RegExp(pattern)
  const done = new Set()
  for (const node of doc.getRoot().listNodes()) {
    if (!re.test(node.getName())) continue
    node.traverse((n) => {
      const mesh = n.getMesh()
      if (!mesh || done.has(mesh)) return
      done.add(mesh)
      for (const prim of mesh.listPrimitives()) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: Number(share), error: Number(process.env.SIMPLIFY_ERROR ?? 0.02), lockBorder: false })
    })
  }
}
for (const ext of doc.getRoot().listExtensionsUsed()) {
  const n = ext.extensionName
  if (n === 'EXT_texture_webp' || n === 'EXT_meshopt_compression' || n === 'KHR_texture_basisu' || n === 'KHR_mesh_quantization') ext.dispose()
}
await io.write(output, doc)
console.log('PNG', output)
