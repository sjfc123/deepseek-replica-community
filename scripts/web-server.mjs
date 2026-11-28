/* ============================================================================
 * 功能区：本地运行 / web-server · 零依赖静态服务器
 * 职责：把生产构建产物 dist/ 以静态站点方式在本机浏览器打开，供网页端使用。
 * 分区：01 常量与 MIME；02 路径解析与文件读取；03 HTTP 服务与启动
 * 关联：被 package.json 的 web:serve 调用；不依赖 node_modules，仅用 Node 内置模块。
 * 导出：无对外导出，直接执行后监听端口。
 * 边界：只做静态资源托管与 SPA 回退；不代理模型接口、不保存 API Key、不做鉴权。
 * ========================================================================== */

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* ---- 01 常量与 MIME ---- */
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')

const argValue = (flag) => {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const ROOT = path.resolve(argValue('--root') ?? process.env.WEB_ROOT ?? path.join(repoRoot, 'dist'))
const PORT = Number(argValue('--port') ?? process.env.PORT ?? 8090)
const HOST = process.env.HOST ?? '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
}

/* ---- 02 路径解析与文件读取 ---- */
const safeJoin = (requestUrlPath) => {
  // 去掉查询串与哈希，归一化后限制在站点根目录内，避免目录穿越。
  const decoded = decodeURIComponent(requestUrlPath.split('?')[0].split('#')[0])
  const resolved = path.normalize(path.join(ROOT, decoded))
  return resolved.startsWith(ROOT) ? resolved : null
}

const readSafe = async (filePath) => {
  try {
    const info = await stat(filePath)
    if (!info.isFile()) {
      return null
    }
    return await readFile(filePath)
  } catch {
    return null
  }
}

const serveFile = async (response, filePath) => {
  const body = await readSafe(filePath)
  if (body === null) {
    return false
  }
  const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  response.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
  })
  response.end(body)
  return true
}

/* ---- 03 HTTP 服务与启动 ---- */
const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Method Not Allowed')
    return
  }

  let filePath = safeJoin(request.url ?? '/')
  if (filePath === null) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Forbidden')
    return
  }

  // 目录请求回退到 index.html
  if (filePath.endsWith(path.sep)) {
    filePath = path.join(filePath, 'index.html')
  }

  const served = await serveFile(response, filePath)
  if (served) {
    return
  }

  // SPA 回退：前端为单页应用，未命中的静态路径交给 index.html。
  const indexPath = path.join(ROOT, 'index.html')
  const indexBody = await readSafe(indexPath)
  if (indexBody === null) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not Found')
    return
  }
  response.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': indexBody.length })
  response.end(indexBody)
})

server.listen(PORT, HOST, () => {
  console.log(`DeepSaga 网页端已启动`)
  console.log(`站点目录：${ROOT}`)
  console.log(`访问地址：http://${HOST}:${PORT}/`)
  console.log('按 Ctrl+C 停止服务。')
})
