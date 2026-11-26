/* ============================================================================
 * 功能区：回归与构建辅助 / test-android-onboarding · 安卓首次启动与引导
 * 职责：安卓首次启动与引导：权限、欢迎页、设置入口与状态持久化。
 * 分区：01 夹具与固定输入；02 验证场景；03 断言与清理
 * 关联：被测或辅助模块 无；由 pnpm 脚本直接执行。
 * 导出：无（独立可执行脚本）
 * 边界：只执行回归、构建与像素比对；不写入产品数据，临时目录在结束时清理。
 * ========================================================================== */

/* ---- 01 夹具与固定输入 ---- */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const [serial, appId = 'io.github.sjfc123.deepsaga'] = process.argv.slice(2)
assert.match(serial ?? '', /^emulator-\d+$/, 'Pass the serial of a test emulator')
assert.match(appId, /^[\w.]+$/)

const executable = process.platform === 'win32' ? 'adb.exe' : 'adb'
const adbPath = process.env.ANDROID_HOME
  ? join(process.env.ANDROID_HOME, 'platform-tools', executable)
  : executable
const adb = (...args) =>
  execFileSync(adbPath, ['-s', serial, ...args], {
    encoding: 'utf8',
    timeout: 15000,
  }).trim()

function webViewOrigin() {
  const file = '/data/local/tmp/ds-compat-onboarding.xml'
  adb('shell', 'uiautomator', 'dump', file)
  const hierarchy = adb('shell', 'cat', file)
  const views = hierarchy.match(/<node [^>]*>/g) ?? []
  const bounds = (
    views.find((view) => view.includes('class="android.webkit.WebView"')) ??
    views.find((view) => view.includes('resource-id="android:id/content"'))
  )?.match(/bounds="\[(-?\d+),(-?\d+)\]/)
  assert.ok(bounds, 'The native hierarchy must expose the WebView position')
  return { x: Number(bounds[1]), y: Number(bounds[2]) }
}

async function until(label, check) {
  const deadline = Date.now() + 12000
  do {
    const value = await check()
    if (value) return value
    await delay(150)
  } while (Date.now() < deadline)
  throw new Error(label)
}

async function launch() {
  adb('shell', 'am', 'start', '-n', `${appId}/io.github.sjfc123.deepsaga.MainActivity`)
  const pid = await until('The app process did not start', () =>
    adb('shell', `pidof ${appId} || true`)
  )
  const port = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`)
  const endpoint = `http://127.0.0.1:${port}/json/list`
  let socket
  try {
    const page = await until('The debug APK did not expose its local WebView', async () => {
      try {
        const pages = await (await fetch(endpoint, { signal: AbortSignal.timeout(1000) })).json()
        return pages.find(({ url }) => url === 'https://appassets.androidplatform.net/index.html')
      } catch {
        return null
      }
    })
    socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
  } catch (error) {
    adb('forward', '--remove', `tcp:${port}`)
    throw error
  }

  const pending = new Map()
  const exceptions = []
  let nextId = 0
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Runtime.exceptionThrown') {
      const { exception, text } = message.params.exceptionDetails
      exceptions.push(exception?.description ?? text)
    }
    pending.get(message.id)?.(message)
  })
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`WebView debugger timed out on ${method}`))
      }, 5000)
      pending.set(id, (message) => {
        clearTimeout(timer)
        pending.delete(id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      userGesture: true,
    })
    assert.equal(
      result.exceptionDetails,
      undefined,
      result.exceptionDetails?.exception?.description
    )
    return result.result.value
  }
  const close = () => {
    socket.close()
    adb('forward', '--remove', `tcp:${port}`)
  }
  try {
    await call('Runtime.enable')
    return { evaluate, exceptions, close }
  } catch (error) {
    close()
    throw error
  }
}

const password = 'input[aria-label="DeepSeek API Key"][type=password]'
const composer = '[data-drawer-open] textarea'
const chatTitle = `Android compatibility test chat ${Date.now()}`
const question = 'Android compatibility smoke test'
const streamReply = 'Android WebView streamed this reply.'
const openSidebar =
  'document.querySelector(\'button[aria-label="Open sidebar"], button[aria-label="打开边栏"]\').click()'
const setInput = (selector, value) => `(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`
const layout = (selector) => `(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  if (!input) return null;
  const rect = input.getBoundingClientRect();
  const wrapper = input.closest('[data-drawer-gesture-ignore]');
  const controlBottom = wrapper ? wrapper.getBoundingClientRect().bottom : rect.bottom;
  const buttonNavigationInset = Number.parseFloat(
    document.documentElement.style.getPropertyValue('--android-button-nav-inset')
  ) || 0;
  const viewport = window.visualViewport;
  const height = viewport ? viewport.height : window.innerHeight;
  const top = viewport ? viewport.offsetTop : 0;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  return {
/* ---- 02 验证场景 ---- */
    height: height,
    frameHeight: document.querySelector('[data-drawer-open], #root > main').getBoundingClientRect().height,
    visible: rect.width > 0 && rect.height > 0 && rect.top >= top
      && controlBottom <= top + height - buttonNavigationInset + 2
      && document.elementFromPoint(x, y) === input,
    keyboard: document.documentElement.hasAttribute('data-keyboard'),
    x: Math.round(x * devicePixelRatio), y: Math.round(y * devicePixelRatio)
  };
})()`

adb('shell', 'am', 'force-stop', appId)
let webview = await launch()
try {
  const { evaluate } = webview
  const initial = await until(
    'A fresh debug install must show a visible API Key form',
    async () => {
      const geometry = await evaluate(layout(password))
      return geometry?.visible && geometry
    }
  )
  console.log(
    `Android API ${adb('shell', 'getprop', 'ro.build.version.sdk')} · ${await evaluate('navigator.userAgent')}`
  )
  const origin = webViewOrigin()
  const tap = ({ x, y }) => adb('shell', 'input', 'tap', String(x + origin.x), String(y + origin.y))
  await evaluate(`(() => {
    const fetch = window.fetch.bind(window);
    const events = [
      { type: 'message_start', message: { id: 'android-compat', role: 'assistant', content: [] } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ${JSON.stringify(streamReply)} } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', title: ${JSON.stringify(chatTitle)} } },
      { type: 'message_stop' }
    ];
    const sse = (event) => new TextEncoder().encode('event: ' + event.type + '\\ndata: ' + JSON.stringify(event) + '\\n\\n');
    window.fetch = (input, init) => {
      const url = new URL(input, location.href);
      if (url.origin !== 'https://api.deepseek.com') return fetch(input, init);
      if (url.pathname === '/models') {
        const valid = new Headers(init.headers).get('Authorization') === 'Bearer android-compat-test';
        return Promise.resolve(new Response(valid ? '{"data":[]}' : '{"error":{"message":"Rejected test key"}}',
          { status: valid ? 200 : 401, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.pathname === '/anthropic/v1/messages' && new Headers(init.headers).get('x-api-key') === 'android-compat-test') {
        const stream = new ReadableStream({ start(controller) {
          events.slice(0, 2).forEach(event => controller.enqueue(sse(event)));
          setTimeout(() => {
            // Simulate a stale cached connection just before the final reply is saved.
            const transaction = IDBDatabase.prototype.transaction;
            IDBDatabase.prototype.transaction = function (stores, mode) {
              if (mode === 'readwrite' && stores.includes('historyState')) {
                IDBDatabase.prototype.transaction = transaction;
                this.close();
              }
              return transaction.apply(this, arguments);
            };
            events.slice(2).forEach(event => controller.enqueue(sse(event)));
            controller.close();
          }, 150);
        } });
        return Promise.resolve(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
      }
      return Promise.reject(new Error('Unexpected DeepSeek request: ' + url.pathname));
    };
  })()`)

  tap(initial)
  await until(
    'The API Key input did not open the Android keyboard',
    async () => (await evaluate(layout(password))).height < initial.height - 40
  )
  adb('shell', 'input', 'text', 'android-compat-invalid')
  await evaluate('document.querySelector("button[type=submit]").click()')
  await until('A rejected key should show an inline error', () =>
    evaluate('!!document.querySelector("form [role=alert]")')
  )
  assert.equal(await evaluate('Boolean(DeepSeekAndroid.readApiKey())'), false)

  await evaluate(setInput(password, 'android-compat-test'))
  await evaluate('document.querySelector("button[type=submit]").click()')
  const chat = await until(
    'Saving the key should render a full-height, clickable conversation',
    async () => {
      const geometry = await evaluate(layout(composer))
      return (
        geometry?.visible &&
        !geometry.keyboard &&
        Math.abs(geometry.height - initial.height) <= 2 &&
        Math.abs(geometry.frameHeight - geometry.height) <= 2 &&
        geometry
      )
    }
  )
  assert.equal(await evaluate('DeepSeekAndroid.readApiKey()'), 'android-compat-test')
  tap(chat)
  await until('The first keyboard opening should leave the composer visible', async () => {
    const geometry = await evaluate(layout(composer))
    return (
      geometry.visible &&
      geometry.height < chat.height - 40 &&
      Math.abs(geometry.frameHeight - geometry.height) <= 2
    )
  })
  await evaluate(setInput(composer, question))
  await evaluate(
    'document.querySelector(\'button[aria-label="Send"], button[aria-label="发送"]\').click()'
  )
  await until('The conversation did not render the streamed reply', () =>
    evaluate(`document.body.innerText.includes(${JSON.stringify(streamReply)})`)
  )
  if ((await evaluate(layout(composer))).height < chat.height - 40) {
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
  }
  await until('Closing the keyboard should restore the full conversation', async () => {
    const geometry = await evaluate(layout(composer))
    return geometry?.visible && !geometry.keyboard && Math.abs(geometry.height - chat.height) <= 2
  })
  assert.equal(await evaluate('!!document.querySelector("main > [role=alert]")'), false)
  await evaluate(openSidebar)
  await until('The open sidebar should move the conversation to the right', () =>
    evaluate(`(() => {
/* ---- 03 断言与清理 ---- */
      const frame = document.querySelector('[data-drawer-open=true]');
      if (!frame) return false;
      const drawer = frame.querySelector('[data-android-drawer]').getBoundingClientRect();
      const main = frame.querySelector('main');
      return drawer.width > 100 && Math.abs(main.getBoundingClientRect().left - drawer.right) <= 2
        && getComputedStyle(frame, '::before').visibility === 'visible'
        && getComputedStyle(main).borderTopLeftRadius === '36px';
    })()`)
  )
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
  await until('Android back should close the sidebar and restore the conversation', async () => {
    const drawerClosed = await evaluate(`(() => {
        const frame = document.querySelector('[data-drawer-open=false]');
        if (!frame) return false;
        const main = getComputedStyle(frame.querySelector('main'));
        return main.transform === 'none' && main.willChange === 'auto' && main.borderTopLeftRadius === '0px'
          && getComputedStyle(frame, '::before').visibility === 'hidden';
      })()`)
    return drawerClosed && (await evaluate(layout(composer)))?.visible
  })
  assert.deepEqual(webview.exceptions, [])
  console.log(
    'PASS key rejection, key save, full-height chat, keyboard, streaming reply, and sidebar'
  )

  webview.close()
  webview = null
  adb('shell', 'am', 'force-stop', appId)
  webview = await launch()
  await until('A cold start with the saved key should render the conversation', async () => {
    const geometry = await webview.evaluate(layout(composer))
    return geometry?.visible && Math.abs(geometry.frameHeight - geometry.height) <= 2
  })
  assert.equal(await webview.evaluate('DeepSeekAndroid.readApiKey()'), 'android-compat-test')
  await webview.evaluate(openSidebar)
  await until('The finished chat should appear in history after a cold start', () =>
    webview.evaluate(`(() => {
      const drawer = document.querySelector('[data-android-drawer]');
      const title = Array.from(drawer.querySelectorAll('div')).find(
        (node) => node.childElementCount === 0 && node.textContent === ${JSON.stringify(chatTitle)}
      );
      if (!title) return false;
      title.click();
      return true;
    })()`)
  )
  await until('The question and finished reply should be restored from local history', () =>
    webview.evaluate(`(() => {
      const text = document.querySelector('main').innerText;
      return text.includes(${JSON.stringify(question)}) && text.includes(${JSON.stringify(streamReply)});
    })()`)
  )
  assert.deepEqual(webview.exceptions, [])
  console.log('PASS cold start with the API key and completed conversation persisted locally')
} catch (error) {
  if (webview?.exceptions.length) console.error(webview.exceptions)
  throw error
} finally {
  webview?.close()
}
